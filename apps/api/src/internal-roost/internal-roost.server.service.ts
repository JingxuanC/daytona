/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { INestApplication, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common'
import { INestApplicationContext } from '@nestjs/common/interfaces'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, Server as HttpsServer, ServerOptions as HttpsServerOptions } from 'node:https'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { TypedConfigService } from '../config/typed-config.service'
import { isApiEnabled } from '../common/utils/app-mode'
import { INTERNAL_ROOST_REQUEST_ID_HEADER, isLoopbackHost, isRoostInternalPath } from './internal-roost.constants'
import { RoostInternalRequest } from './interfaces/roost-request.interface'
import { InternalRoostUpgradeService } from './internal-roost.upgrade.service'

type RoostServer = HttpServer | HttpsServer

const LOOPBACK_FALLBACK_HOST = '127.0.0.1'

/**
 * Creates the dedicated internal Roost listener.
 *
 * The listener shares the Nest express instance (so DI, pipes, interceptors and
 * exception filters are reused) but:
 * - binds to an internal address only (loopback by default),
 * - enforces mTLS with a configurable CA (`requestCert` + `rejectUnauthorized`),
 * - only dispatches `/internal/roost/**` paths.
 *
 * `internalRoostIsolationMiddleware` keeps the same routes unreachable from the public
 * API port, so `/internal/roost/**` exists exactly once - on this listener.
 */
@Injectable()
export class InternalRoostServerService implements OnApplicationShutdown {
  private readonly logger = new Logger(InternalRoostServerService.name)
  private server?: RoostServer
  private started = false
  private address: { host: string; port: number; tls: boolean } | null = null

  constructor(
    private readonly configService: TypedConfigService,
    @Optional() private readonly upgradeService?: InternalRoostUpgradeService,
  ) {}

  async start(app: INestApplication | INestApplicationContext): Promise<void> {
    if (!isApiEnabled()) {
      this.logger.log('Internal Roost API is not started in worker-only mode')
      return
    }

    const internalRoost = this.configService.get('internalRoost')
    if (!internalRoost.enabled) {
      this.logger.warn('Internal Roost API is disabled (INTERNAL_ROOST_ENABLED=false)')
      return
    }

    const isProduction = this.configService.get('production')
    const tls = internalRoost.tls
    const hasTls = Boolean(tls.certPath && tls.keyPath)
    const hasMtls = hasTls && Boolean(tls.caPath)

    const jwtPrivateKeyConfigured = Boolean(
      internalRoost.jwt.privateKeyPem || internalRoost.jwt.privateKeyPath,
    )
    if (isProduction && (!hasMtls || !jwtPrivateKeyConfigured)) {
      // Existing deployments must keep booting after this fork update. The internal
      // API is simply not served until it is configured; the public API is unaffected.
      this.logger.error(
        'Internal Roost API is NOT started: production requires mTLS (INTERNAL_ROOST_TLS_CERT_PATH, INTERNAL_ROOST_TLS_KEY_PATH, INTERNAL_ROOST_TLS_CA_PATH) and a configured JWT signing key (INTERNAL_ROOST_JWT_PRIVATE_KEY_PATH). Set INTERNAL_ROOST_ENABLED=false to silence this error.',
      )
      return
    }

    let host = internalRoost.host || LOOPBACK_FALLBACK_HOST
    if (!hasMtls) {
      // No client authentication possible: only allow the unauthenticated dev fallback
      // on a loopback listener with an explicit warning.
      host = LOOPBACK_FALLBACK_HOST
      this.logger.warn(
        'Internal Roost API is starting WITHOUT mTLS (INTERNAL_ROOST_TLS_CA_PATH not set). Development fallback: binding 127.0.0.1 only; every caller from loopback is accepted. Do not use this configuration outside development.',
      )
    }

    await this.assertSafeListenHost(host, internalRoost.allowNonLoopback)

    const expressInstance = this.getExpressInstance(app)
    const dispatcher = this.createDispatcher(expressInstance)

    if (hasTls) {
      const serverOptions: HttpsServerOptions = {
        key: this.readRequiredFile(tls.keyPath, 'INTERNAL_ROOST_TLS_KEY_PATH'),
        cert: this.readRequiredFile(tls.certPath, 'INTERNAL_ROOST_TLS_CERT_PATH'),
        minVersion: 'TLSv1.2',
      }
      if (hasMtls) {
        serverOptions.ca = this.readRequiredFile(tls.caPath, 'INTERNAL_ROOST_TLS_CA_PATH')
        serverOptions.requestCert = true
        serverOptions.rejectUnauthorized = true
      }
      this.server = createHttpsServer(serverOptions, dispatcher)
    } else {
      this.server = createHttpServer(dispatcher)
    }

    this.attachWebSocketUpgradeHandler(this.server)

    await new Promise<void>((resolve, reject) => {
      const server = this.server as RoostServer
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(internalRoost.port, host)
    })

    this.started = true
    const listeningAddress = this.server.address()
    this.address =
      listeningAddress && typeof listeningAddress === 'object'
        ? { host: listeningAddress.address, port: listeningAddress.port, tls: hasTls }
        : { host, port: internalRoost.port, tls: hasTls }
    const scheme = hasTls ? 'https' : 'http'
    const authMode = hasMtls ? 'mTLS' : 'dev loopback fallback (no mTLS)'
    this.logger.log(
      `Internal Roost API listening on ${scheme}://${host}:${internalRoost.port}/internal/roost/v1 (${authMode})`,
    )
  }

  /**
   * WebSocket upgrades (preview/VNC) are handled outside the express pipeline: the
   * upgrade service performs data-plane credential validation before the runner
   * handshake. Non data-plane upgrade requests are destroyed by the upgrade service.
   */
  private attachWebSocketUpgradeHandler(server: RoostServer): void {
    if (!this.upgradeService) {
      this.logger.warn('Internal Roost WebSocket upgrade handler is not registered')
      return
    }
    server.on('upgrade', (request, socket, head) => {
      void this.upgradeService!.handleUpgrade(request, socket, head).catch((error) => {
        this.logger.error('Unhandled internal Roost WebSocket upgrade error', error as Error)
        socket.destroy()
      })
    })
    this.logger.log('Internal Roost WebSocket upgrade handler registered (/sandboxes/{id}/(preview|toolbox))')
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server || !this.started) {
      return
    }
    const server = this.server
    this.started = false
    this.server = undefined
    this.address = null
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // Do not let keep-alive connections block shutdown.
      server.closeAllConnections?.()
    })
  }

  /** For tests/health checks: whether the internal listener is currently accepting. */
  isStarted(): boolean {
    return this.started
  }

  /** Actual bound address (useful when `INTERNAL_ROOST_PORT=0` is used in tests). */
  getAddress(): { host: string; port: number; tls: boolean } | null {
    return this.address
  }

  private getExpressInstance(app: INestApplication | INestApplicationContext): (req: unknown, res: unknown, next?: unknown) => void {
    const adapter = (app as INestApplication).getHttpAdapter?.()
    const instance = adapter?.getInstance?.()
    if (typeof instance !== 'function') {
      throw new Error('Unable to access the Nest express instance for the internal Roost listener')
    }
    return instance as (req: unknown, res: unknown, next?: unknown) => void
  }

  private createDispatcher(expressInstance: (req: unknown, res: unknown, next?: unknown) => void) {
    return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
      const roostRequest = req as RoostInternalRequest
      roostRequest.roostInternalListener = true

      const path = (req.url || '').split('?')[0]
      if (!isRoostInternalPath(path)) {
        this.writeError(res, 404, 'not_found', 'Not found', req)
        return
      }

      try {
        expressInstance(req, res, (error?: unknown) => {
          if (error) {
            this.logger.error('Unhandled error on the internal Roost listener', error as Error)
            if (!res.headersSent) {
              this.writeError(res, 500, 'upstream_unavailable', 'Internal error', req)
            }
          }
        })
      } catch (error) {
        this.logger.error('Failed to dispatch internal Roost request', error as Error)
        if (!res.headersSent) {
          this.writeError(res, 500, 'upstream_unavailable', 'Internal error', req)
        }
      }
    }
  }

  private writeError(
    res: import('node:http').ServerResponse,
    statusCode: number,
    code: string,
    message: string,
    req: import('node:http').IncomingMessage,
  ): void {
    const headerRequestId = req.headers[INTERNAL_ROOST_REQUEST_ID_HEADER]
    const requestId =
      typeof headerRequestId === 'string' && headerRequestId.trim().length > 0 ? headerRequestId.trim() : randomUUID()
    res.statusCode = statusCode
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { code, message, request_id: requestId } }))
  }

  private readRequiredFile(path: string | undefined, envName: string): Buffer {
    if (!path) {
      throw new Error(`${envName} must be configured for the internal Roost API`)
    }
    return readFileSync(path)
  }

  /**
   * Refuses to bind the internal API to a public interface.
   *
   * Loopback and private (RFC1918 / ULA / link-local) addresses are accepted; wildcard
   * binds and public addresses are rejected unless `INTERNAL_ROOST_ALLOW_NON_LOOPBACK`
   * is explicitly set (and even then public addresses stay rejected).
   */
  private async assertSafeListenHost(host: string, allowNonLoopback: boolean): Promise<void> {
    if (isLoopbackHost(host)) {
      return
    }

    if (host === '0.0.0.0' || host === '::' || host === '*') {
      if (!allowNonLoopback) {
        throw new Error(
          `Internal Roost API refuses to bind ${host}: it would be reachable from every interface. Set INTERNAL_ROOST_HOST to a private interface address or explicitly allow it with INTERNAL_ROOST_ALLOW_NON_LOOPBACK=true`,
        )
      }
      this.logger.warn(`Internal Roost API binds ${host} because INTERNAL_ROOST_ALLOW_NON_LOOPBACK=true`)
      return
    }

    const addresses = await this.resolveAddresses(host)
    if (addresses.length === 0) {
      throw new Error(`Internal Roost API cannot resolve listen host ${host}`)
    }

    const publicAddresses = addresses.filter((address) => !isPrivateOrLoopbackAddress(address))
    if (publicAddresses.length > 0) {
      throw new Error(
        `Internal Roost API refuses to listen on public address(es) ${publicAddresses.join(', ')} (host ${host}). The internal API must stay on an internal network.`,
      )
    }
  }

  private async resolveAddresses(host: string): Promise<string[]> {
    if (isIP(host) !== 0) {
      return [host]
    }
    try {
      const resolved = await lookup(host, { all: true })
      return resolved.map((entry) => entry.address)
    } catch (error) {
      throw new Error(`Unable to resolve internal Roost listen host ${host}: ${(error as Error).message}`)
    }
  }
}

export function isPrivateOrLoopbackAddress(address: string): boolean {
  if (isLoopbackHost(address)) {
    return true
  }
  if (isIP(address) === 4) {
    const octets = address.split('.').map((value) => parseInt(value, 10))
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
      return false
    }
    if (octets[0] === 10) return true
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
    if (octets[0] === 192 && octets[1] === 168) return true
    if (octets[0] === 169 && octets[1] === 254) return true
    return false
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    if (normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true
    }
    return false
  }
  return false
}
