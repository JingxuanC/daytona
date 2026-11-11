/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { HttpException, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  STATUS_CODES,
  request as httpRequest,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Duplex } from 'node:stream'
import { TLSSocket } from 'node:tls'
import { TypedConfigService } from '../config/typed-config.service'
import { ParsedDataPlaneUpgradeRequest, ResolvedDataPlaneTarget, RoostDataPlaneKind } from './dto/data-plane.dto'
import { RoostScope } from './enums/roost-scope.enum'
import { RoostAudience } from './enums/roost-audience.enum'
import { mapStatusToRoostErrorCode } from './filters/roost-exceptions.filter'
import { INTERNAL_ROOST_REQUEST_ID_HEADER } from './internal-roost.constants'
import { RoostJwtClaims } from './interfaces/roost-jwt-claims.interface'
import { RoostCredentialsService } from './services/roost-credentials.service'
import { RoostDataPlaneService } from './services/roost-data-plane.service'

/** Rejection of a WebSocket upgrade, rendered as the internal Roost error envelope. */
export class RoostUpgradeRejection extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoostUpgradeRejection'
  }
}

const DATA_PLANE_UPGRADE_REGEX = /^\/internal\/roost\/v1\/sandboxes\/([^/]+)\/(toolbox|preview)(\/.*)?$/
const FORWARDED_WEBSOCKET_HEADERS = [
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
  'origin',
  'user-agent',
]

/**
 * WebSocket upgrade handling for the internal data plane (M3.1).
 *
 * The internal HTTPS listener's TLS layer already performed mTLS. Before any byte is
 * proxied this service:
 * 1. only accepts `/internal/roost/v1/sandboxes/{sandboxId}/(preview|toolbox)/*`
 *    upgrades (everything else is destroyed silently),
 * 2. verifies the `aud=daytona-data` Bearer credential, its `sandbox_id`/path binding,
 *    the `preview`/`toolbox` scope and the revocation list (401/403 HTTP response on
 *    failure),
 * 3. resolves sandbox → runner through `RoostDataPlaneService` (same org/state rules as
 *    the HTTP data plane: 404/409/502),
 * 4. performs the upstream WebSocket handshake against the runner proxy, forwards the
 *    101 response, and pipes both sockets. Idle sockets are never timed out here.
 *
 * Client `Authorization` and `Cookie` headers are never forwarded to the runner; the
 * runner credential is injected as `X-Daytona-Authorization`.
 */
@Injectable()
export class InternalRoostUpgradeService {
  private readonly logger = new Logger(InternalRoostUpgradeService.name)

  constructor(
    private readonly credentialsService: RoostCredentialsService,
    private readonly dataPlaneService: RoostDataPlaneService,
    private readonly configService: TypedConfigService,
  ) {}

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const requestId = getRequestId(request)

    try {
      if (!isWebSocketUpgrade(request.headers)) {
        throw new RoostUpgradeRejection(400, 'invalid_request', 'Expected a WebSocket upgrade request')
      }

      const parsed = parseDataPlaneUpgradeUrl(request.url)
      if (!parsed) {
        // Only the two documented data-plane route families may upgrade.
        socket.destroy()
        return
      }

      this.assertTransportAllowed(socket)

      const claims = await this.authenticate(request.headers, parsed)
      const target = await this.dataPlaneService.resolveTarget({
        kind: parsed.kind,
        sandboxId: parsed.sandboxId,
        orgId: claims.org_id as string,
        originalUrl: request.url as string,
      })

      this.openUpstream(request, socket, head, target, requestId)
    } catch (error) {
      this.rejectUpgrade(socket, error, requestId)
    }
  }

  private assertTransportAllowed(socket: Duplex): void {
    const internalRoost = this.configService.get('internalRoost')
    const hasMtls = Boolean(internalRoost.tls.caPath)

    if (hasMtls) {
      const tlsSocket = socket as TLSSocket
      if (!tlsSocket.authorized) {
        throw new RoostUpgradeRejection(401, 'unauthorized', 'Client certificate is not authorized')
      }
      return
    }

    // Matches the HTTP data-plane fallback: mTLS-less internal API is loopback-only in
    // non-production environments (the listener itself refuses to start in production).
    if (this.configService.get('production')) {
      throw new RoostUpgradeRejection(403, 'forbidden', 'Internal Roost WebSocket requires mTLS')
    }
    const remoteAddress = (socket as unknown as { remoteAddress?: string }).remoteAddress
    if (!isLoopbackAddress(remoteAddress)) {
      throw new RoostUpgradeRejection(403, 'forbidden', 'Internal Roost WebSocket requires a loopback connection')
    }
  }

  private async authenticate(
    headers: IncomingHttpHeaders,
    parsed: ParsedDataPlaneUpgradeRequest,
  ): Promise<RoostJwtClaims> {
    const token = getBearerToken(headers)
    if (!token) {
      throw new RoostUpgradeRejection(401, 'unauthorized', 'Missing Authorization bearer credential')
    }

    let claims: RoostJwtClaims
    try {
      claims = this.credentialsService.verifyDataToken(token)
    } catch (error) {
      throw new RoostUpgradeRejection(401, 'unauthorized', `Invalid credential: ${(error as Error).message}`)
    }

    if (claims.aud !== RoostAudience.DATA) {
      throw new RoostUpgradeRejection(403, 'forbidden', 'Credential audience is not daytona-data')
    }
    if (!claims.sandbox_id || claims.sandbox_id !== parsed.sandboxId) {
      throw new RoostUpgradeRejection(
        403,
        'forbidden',
        'Credential sandbox_id does not match the sandbox in the request path',
      )
    }
    const requiredScope = parsed.kind === 'preview' ? RoostScope.PREVIEW : RoostScope.TOOLBOX
    if (!claims.scope.includes(requiredScope)) {
      throw new RoostUpgradeRejection(403, 'forbidden', `Missing required data-plane scope: ${requiredScope}`)
    }
    if (!claims.org_id) {
      throw new RoostUpgradeRejection(403, 'forbidden', 'Credential is not bound to an organization')
    }

    try {
      await this.credentialsService.assertNotRevoked(claims.jti)
    } catch (error) {
      if (error instanceof HttpException) {
        throw new RoostUpgradeRejection(
          error.getStatus(),
          mapStatusToRoostErrorCode(error.getStatus()),
          error.message,
        )
      }
      throw new RoostUpgradeRejection(401, 'unauthorized', 'Credential has been revoked')
    }

    return claims
  }

  private openUpstream(
    request: IncomingMessage,
    clientSocket: Duplex,
    clientHead: Buffer,
    target: ResolvedDataPlaneTarget,
    requestId: string,
  ): void {
    let targetUrl: URL
    try {
      targetUrl = new URL(target.targetUrl)
    } catch {
      this.writeError(clientSocket, 502, 'upstream_unavailable', 'Invalid upstream runner URL', requestId)
      return
    }

    const headers = buildUpgradeRequestHeaders(
      request.headers,
      target.upstreamHeaders['X-Daytona-Authorization'],
      request.headers.host,
    )
    const transport = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest

    const upstreamRequest = transport({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      headers,
      agent: false,
    })

    upstreamRequest.on('upgrade', (proxyResponse, upstreamSocket, upstreamHead) => {
      const responseHead = formatUpgradeResponseHead(proxyResponse)
      clientSocket.write(responseHead)
      if (upstreamHead && upstreamHead.length > 0) {
        clientSocket.write(upstreamHead)
      }
      if (clientHead && clientHead.length > 0) {
        upstreamSocket.write(clientHead)
      }

      upstreamSocket.pipe(clientSocket)
      clientSocket.pipe(upstreamSocket)

      // Idle WebSocket sessions are intentionally left open: no socket timeout is set.
      const destroyBoth = () => {
        if (!upstreamSocket.destroyed) {
          upstreamSocket.destroy()
        }
        if (!clientSocket.destroyed) {
          clientSocket.destroy()
        }
      }
      upstreamSocket.on('error', destroyBoth)
      clientSocket.on('error', destroyBoth)
      upstreamSocket.on('close', () => {
        if (!clientSocket.destroyed) {
          clientSocket.destroy()
        }
      })
      clientSocket.on('close', () => {
        if (!upstreamSocket.destroyed) {
          upstreamSocket.destroy()
        }
      })
    })

    // Upstream answered the handshake with a normal HTTP response (e.g. 403/404).
    upstreamRequest.on('response', (upstreamResponse) => {
      const chunks: Buffer[] = []
      upstreamResponse.on('data', (chunk: Buffer) => chunks.push(chunk))
      upstreamResponse.on('end', () => {
        writeRawHttpResponse(
          clientSocket,
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
          Buffer.concat(chunks),
        )
      })
      upstreamResponse.on('error', () => clientSocket.destroy())
    })

    upstreamRequest.on('error', (error) => {
      this.logger.warn(`WebSocket upstream error for sandbox ${target.sandboxId}: ${error.message}`)
      this.writeError(
        clientSocket,
        502,
        'upstream_unavailable',
        `Runner upstream is unavailable: ${error.message}`,
        requestId,
      )
    })

    clientSocket.on('close', () => upstreamRequest.destroy())
    upstreamRequest.end()
  }

  private rejectUpgrade(socket: Duplex, error: unknown, requestId: string): void {
    if (socket.destroyed) {
      return
    }

    if (error instanceof RoostUpgradeRejection) {
      this.writeError(socket, error.statusCode, error.code, error.message, requestId)
      return
    }
    if (error instanceof HttpException) {
      this.writeError(
        socket,
        error.getStatus(),
        mapStatusToRoostErrorCode(error.getStatus()),
        error.message,
        requestId,
      )
      return
    }

    this.logger.error('Unexpected WebSocket upgrade failure', error as Error)
    this.writeError(socket, 502, 'upstream_unavailable', 'Internal error', requestId)
  }

  private writeError(socket: Duplex, statusCode: number, code: string, message: string, requestId: string): void {
    const statusText = STATUS_CODES[statusCode] ?? 'Error'
    const body = JSON.stringify({ error: { code, message, request_id: requestId } })
    const response =
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      'content-type: application/json\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n' +
      '\r\n' +
      body
    writeAndClose(socket, response)
  }
}

/** True only for a real WebSocket upgrade handshake. */
export function isWebSocketUpgrade(headers: IncomingHttpHeaders): boolean {
  return (
    String(headers.upgrade ?? '').toLowerCase() === 'websocket' &&
    typeof headers['sec-websocket-key'] === 'string' &&
    headers['sec-websocket-key'].length > 0
  )
}

/**
 * Parses a data-plane upgrade URL. Returns `null` for anything that is not the
 * documented `/internal/roost/v1/sandboxes/{sandboxId}/(preview|toolbox)/*` family.
 */
export function parseDataPlaneUpgradeUrl(url: string | undefined): ParsedDataPlaneUpgradeRequest | null {
  if (!url) {
    return null
  }
  const path = url.split('?')[0]
  const match = DATA_PLANE_UPGRADE_REGEX.exec(path)
  if (!match) {
    return null
  }

  let sandboxId: string
  try {
    sandboxId = decodeURIComponent(match[1])
  } catch {
    return null
  }

  const queryIndex = url.indexOf('?')
  return {
    kind: match[2] as RoostDataPlaneKind,
    sandboxId,
    restPath: match[3] ?? '',
    rawQuery: queryIndex >= 0 ? url.slice(queryIndex + 1) : '',
  }
}

/** Extracts the Bearer token from the upgrade request headers. */
export function getBearerToken(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization
  if (typeof header !== 'string') {
    return null
  }
  const [scheme, value] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) {
    return null
  }
  return value.trim() || null
}

/**
 * Builds the upstream handshake headers.
 *
 * Only the WebSocket handshake headers (`Sec-WebSocket-*`), `Origin` and `User-Agent`
 * are forwarded. Client `Authorization` and `Cookie` are deliberately dropped, and the
 * runner credential is injected as `X-Daytona-Authorization`.
 */
export function buildUpgradeRequestHeaders(
  incoming: IncomingHttpHeaders,
  runnerAuthorization: string | undefined,
  originalHost?: string,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {
    connection: 'Upgrade',
    upgrade: 'websocket',
  }

  for (const name of FORWARDED_WEBSOCKET_HEADERS) {
    const value = incoming[name]
    if (value !== undefined) {
      headers[name] = value
    }
  }
  if (runnerAuthorization) {
    headers['x-daytona-authorization'] = runnerAuthorization
  }
  if (originalHost) {
    headers['x-forwarded-host'] = originalHost
  }
  return headers
}

/** Formats the `101 Switching Protocols` response head received from the runner. */
export function formatUpgradeResponseHead(upstreamResponse: IncomingMessage): string {
  const lines: string[] = ['HTTP/1.1 101 Switching Protocols']
  for (const [key, value] of Object.entries(upstreamResponse.headers)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'content-length' || lowerKey === 'transfer-encoding' || value === undefined) {
      continue
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      lines.push(`${key}: ${entry}`)
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

/** Writes a raw HTTP response and closes the socket gracefully. */
export function writeRawHttpResponse(
  socket: Duplex,
  statusCode: number,
  statusMessage: string | undefined,
  headers: IncomingHttpHeaders,
  body?: Buffer,
): void {
  const statusText = statusMessage || STATUS_CODES[statusCode] || 'Error'
  const lines: string[] = [`HTTP/1.1 ${statusCode} ${statusText}`]
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase()
    if (
      lowerKey === 'content-length' ||
      lowerKey === 'transfer-encoding' ||
      lowerKey === 'connection' ||
      value === undefined
    ) {
      continue
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      lines.push(`${key}: ${entry}`)
    }
  }
  if (body && body.length > 0) {
    lines.push(`content-length: ${body.length}`)
  }
  lines.push('connection: close')
  const head = `${lines.join('\r\n')}\r\n\r\n`
  const payload = Buffer.concat([Buffer.from(head, 'utf8'), body ?? Buffer.alloc(0)])
  writeAndClose(socket, payload)
}

function writeAndClose(socket: Duplex, payload: string | Buffer): void {
  if (socket.destroyed) {
    return
  }
  socket.write(payload)
  socket.end()
  // Ensure a stuck peer cannot keep the rejected upgrade socket open forever.
  const timer = setTimeout(() => {
    if (!socket.destroyed) {
      socket.destroy()
    }
  }, 1000)
  timer.unref?.()
}

function getRequestId(request: IncomingMessage): string {
  const header = request.headers[INTERNAL_ROOST_REQUEST_ID_HEADER]
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim()
  }
  return randomUUID()
}

function isLoopbackAddress(address?: string): boolean {
  if (!address) {
    return false
  }
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return normalized === '127.0.0.1' || normalized === '::1'
}
