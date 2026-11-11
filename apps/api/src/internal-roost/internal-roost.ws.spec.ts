/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Controller, Get, INestApplication, Module, NotFoundException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { SandboxState } from '../sandbox/enums/sandbox-state.enum'
import { INTERNAL_ROOST_GLOBAL_PREFIX_EXCLUDE } from './internal-roost.constants'
import { internalRoostIsolationMiddleware } from './internal-roost.isolation.middleware'
import { InternalRoostServerService } from './internal-roost.server.service'
import { InternalRoostUpgradeService } from './internal-roost.upgrade.service'
import { RoostRevokedCredential } from './entities/roost-revoked-credential.entity'
import { RoostCredentialsService } from './services/roost-credentials.service'
import { RoostDataPlaneService } from './services/roost-data-plane.service'
import { RoostKeyService } from './services/roost-key.service'

@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { ok: true }
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

function setConfigPath(target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] = current[parts[index]] ?? {}
    current = current[parts[index]]
  }
  current[parts[parts.length - 1]] = value
}

function createConfigService(overrides: Record<string, unknown> = {}): any {
  const values: Record<string, any> = {
    production: false,
    internalRoost: {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowNonLoopback: false,
      tls: { certPath: undefined, keyPath: undefined, caPath: undefined, clientCnAllowlist: [] },
      jwt: {
        issuer: 'daytona',
        privateKeyPath: undefined,
        publicKeyPath: undefined,
        privateKeyPem: undefined,
        publicKeyPem: undefined,
      },
    },
  }
  for (const [path, value] of Object.entries(overrides)) {
    setConfigPath(values, path, value)
  }
  return { get: (key: string) => key.split('.').reduce<any>((current, part) => current?.[part], values) }
}

function createCredentialsService(): RoostCredentialsService {
  const config = createConfigService()
  const keyService = new RoostKeyService(config)
  keyService.onModuleInit()
  const revocationRows = new Map<string, RoostRevokedCredential>()
  const repository = {
    findOne: async ({ where }: any) => revocationRows.get(where.jti) ?? null,
    save: async (row: RoostRevokedCredential) => {
      revocationRows.set(row.jti, row)
      return row
    },
    delete: async () => ({ affected: 0 }),
  }
  return new RoostCredentialsService(keyService, config, repository as any)
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function closeServer(server: http.Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
    server.closeAllConnections?.()
  })
}

function createFakeRunner() {
  const state = {
    upgradeRequests: [] as Array<{ url: string; headers: http.IncomingHttpHeaders }>,
    closedSockets: 0,
  }
  const wss = new WebSocketServer({ noServer: true })
  const server = http.createServer((request, response) => {
    response.statusCode = 404
    response.end('not an upgrade')
  })

  server.on('upgrade', (request, socket, head) => {
    state.upgradeRequests.push({ url: request.url ?? '', headers: request.headers })
    if ((request.url ?? '').includes('/reject')) {
      socket.write('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      client.on('message', (data) => client.send(`echo:${data.toString()}`))
      client.on('close', () => {
        state.closedSockets += 1
      })
      client.on('error', () => undefined)
    })
  })

  return { server, wss, state }
}

function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer)
        resolve()
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new Error('waitFor timed out'))
      }
    }, 20)
  })
}

interface WsConnectOptions {
  headers?: Record<string, string>
  rejectUnauthorized?: boolean
}

function openWebSocket(url: string, options: WsConnectOptions = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url, {
      headers: options.headers,
      rejectUnauthorized: options.rejectUnauthorized,
    } as any)
    client.once('open', () => resolve(client))
    client.once('error', (error: Error & { statusCode?: number }) => {
      client.terminate()
      reject(error)
    })
    client.once('unexpected-response', (_request, response) => {
      response.resume()
      client.terminate()
      const error = new Error(`Unexpected upstream response: ${response.statusCode}`) as Error & {
        statusCode?: number
      }
      error.statusCode = response.statusCode
      reject(error)
    })
  })
}

function expectWebSocketFailure(url: string, options: WsConnectOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url, {
      headers: options.headers,
      rejectUnauthorized: options.rejectUnauthorized,
    } as any)
    client.once('unexpected-response', (_request, response) => {
      response.resume()
      client.terminate()
      resolve(response.statusCode ?? 0)
    })
    client.once('error', (error) => {
      client.terminate()
      reject(error)
    })
    client.once('open', () => {
      client.close()
      reject(new Error('Expected the upgrade to be rejected but it succeeded'))
    })
  })
}

function echo(client: WebSocket, message: string): Promise<string> {
  return new Promise((resolve) => {
    client.once('message', (data) => resolve(data.toString()))
    client.send(message)
  })
}

describe('Internal Roost WebSocket upgrade (integration)', () => {
  let app: INestApplication
  let internalPort: number
  let serverService: InternalRoostServerService
  let upgradeService: InternalRoostUpgradeService
  let dataPlaneService: RoostDataPlaneService
  let credentials: RoostCredentialsService
  let fakeRunner: ReturnType<typeof createFakeRunner>
  let runnerPort: number
  let closedPort: number
  let closedServer: http.Server
  const clients: WebSocket[] = []

  function issueToken(
    scope: 'preview' | 'toolbox',
    sandboxId = 'sbx-1',
    orgId = 'org-1',
    aud: 'daytona-data' | 'daytona-control' = 'daytona-data',
  ): string {
    return credentials.issueCredential(
      {
        aud,
        org_id: aud === 'daytona-control' ? orgId : orgId,
        sandbox_id: aud === 'daytona-data' ? sandboxId : null,
        scope: [scope],
      },
      'CN=market-edge',
    ).token
  }

  async function connect(url: string, headers?: Record<string, string>): Promise<WebSocket> {
    const client = await openWebSocket(url, { headers })
    clients.push(client)
    return client
  }

  beforeAll(async () => {
    fakeRunner = createFakeRunner()
    runnerPort = await listen(fakeRunner.server)

    closedServer = http.createServer()
    closedPort = await listen(closedServer)
    await closeServer(closedServer)

    const sandboxes: Record<string, any> = {
      'sbx-1': { id: 'sbx-1', organizationId: 'org-1', state: SandboxState.STARTED, runnerId: 'runner-1' },
      'sbx-down': { id: 'sbx-down', organizationId: 'org-1', state: SandboxState.STARTED, runnerId: 'runner-down' },
    }
    const sandboxService = {
      findOne: jest.fn(async (sandboxId: string) => {
        const sandbox = sandboxes[sandboxId]
        if (!sandbox) {
          throw new NotFoundException(`Sandbox ${sandboxId} not found`)
        }
        return sandbox
      }),
    }
    const runnerService = {
      findOne: jest.fn(async (runnerId: string) => {
        if (runnerId === 'runner-1') {
          return { id: 'runner-1', proxyUrl: `http://127.0.0.1:${runnerPort}`, apiKey: 'runner-key' }
        }
        if (runnerId === 'runner-down') {
          return { id: 'runner-down', proxyUrl: `http://127.0.0.1:${closedPort}`, apiKey: 'runner-key' }
        }
        return null
      }),
    }

    dataPlaneService = new RoostDataPlaneService(sandboxService as any, runnerService as any)
    credentials = createCredentialsService()
    const config = createConfigService()

    upgradeService = new InternalRoostUpgradeService(credentials, dataPlaneService, config)
    serverService = new InternalRoostServerService(config, upgradeService)

    app = await NestFactory.create(ProbeModule, { logger: false })
    app.setGlobalPrefix('api', { exclude: INTERNAL_ROOST_GLOBAL_PREFIX_EXCLUDE })
    app.use(internalRoostIsolationMiddleware)
    await app.listen(0, '127.0.0.1')
    await serverService.start(app)
    internalPort = serverService.getAddress()?.port as number
  })

  afterAll(async () => {
    for (const client of clients) {
      client.terminate()
    }
    await serverService?.onApplicationShutdown()
    await app?.close()
    fakeRunner?.wss.close()
    await closeServer(fakeRunner?.server)
  })

  it('proxies a preview WebSocket echo through the internal listener', async () => {
    const token = issueToken('preview')
    const client = await connect(
      `ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-1/preview/3000/ws?x=1`,
      { authorization: `Bearer ${token}`, cookie: 'session=must-not-leak' },
    )

    await expect(echo(client, 'hello')).resolves.toBe('echo:hello')
    client.close()

    const request = fakeRunner.state.upgradeRequests.at(-1)
    expect(request?.url).toBe('/sandboxes/sbx-1/toolbox/proxy/3000/ws?x=1')
    expect(request?.headers['x-daytona-authorization']).toBe('Bearer runner-key')
    expect(request?.headers['sec-websocket-key']).toBeTruthy()
    expect(request?.headers.authorization).toBeUndefined()
    expect(request?.headers.cookie).toBeUndefined()

    await waitFor(() => fakeRunner.state.closedSockets > 0)
  })

  it('proxies a toolbox WebSocket echo', async () => {
    const token = issueToken('toolbox')
    const client = await connect(
      `ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-1/toolbox/api/ws`,
      { authorization: `Bearer ${token}` },
    )

    await expect(echo(client, 'toolbox')).resolves.toBe('echo:toolbox')
    client.close()

    expect(fakeRunner.state.upgradeRequests.at(-1)?.url).toBe('/sandboxes/sbx-1/toolbox/api/ws')
  })

  it('honours the ?port= convention for preview', async () => {
    const token = issueToken('preview')
    const client = await connect(
      `ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-1/preview/ws?port=8080`,
      { authorization: `Bearer ${token}` },
    )

    await expect(echo(client, 'port')).resolves.toBe('echo:port')
    client.close()

    expect(fakeRunner.state.upgradeRequests.at(-1)?.url).toBe('/sandboxes/sbx-1/toolbox/proxy/8080/ws')
  })

  it('rejects a credential bound to another sandbox with 403', async () => {
    const token = issueToken('preview', 'sbx-other')
    await expect(
      expectWebSocketFailure(`ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-1/preview/3000/ws`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    ).resolves.toBe(403)
  })

  it('rejects a missing credential with 401', async () => {
    await expect(
      expectWebSocketFailure(`ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-1/preview/3000/ws`),
    ).resolves.toBe(401)
  })

  it('forwards an upstream handshake rejection (403) back to the client', async () => {
    const token = issueToken('preview')
    await expect(
      expectWebSocketFailure(
        `ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-1/preview/3000/reject/ws`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
    ).resolves.toBe(403)
  })

  it('returns 502 when the runner proxy is unreachable', async () => {
    const token = issueToken('preview', 'sbx-down')
    await expect(
      expectWebSocketFailure(`ws://127.0.0.1:${internalPort}/internal/roost/v1/sandboxes/sbx-down/preview/3000/ws`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    ).resolves.toBe(502)
  })

  it('destroys upgrades outside the data-plane route families', async () => {
    await expect(
      expectWebSocketFailure(`ws://127.0.0.1:${internalPort}/internal/roost/v1/runners/runner-1`, {
        headers: { authorization: 'Bearer whatever' },
      }),
    ).rejects.toBeTruthy()
  })

  describe('over TLS (self-signed certificate)', () => {
    let tlsDir: string | null = null
    let tlsServerService: InternalRoostServerService | null = null
    let tlsPort: number | null = null
    let opensslAvailable = true

    beforeAll(async () => {
      try {
        tlsDir = mkdtempSync(join(tmpdir(), 'roost-ws-tls-'))
        execFileSync(
          'openssl',
          [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            join(tlsDir, 'key.pem'),
            '-out',
            join(tlsDir, 'cert.pem'),
            '-days',
            '1',
            '-subj',
            '/CN=localhost',
          ],
          { stdio: 'ignore' },
        )
      } catch {
        opensslAvailable = false
        return
      }

      const tlsConfig = createConfigService({
        'internalRoost.tls.certPath': join(tlsDir, 'cert.pem'),
        'internalRoost.tls.keyPath': join(tlsDir, 'key.pem'),
      })
      tlsServerService = new InternalRoostServerService(
        tlsConfig,
        new InternalRoostUpgradeService(credentials, dataPlaneService, tlsConfig),
      )
      await tlsServerService.start(app)
      tlsPort = tlsServerService.getAddress()?.port as number
    })

    afterAll(async () => {
      await tlsServerService?.onApplicationShutdown()
      if (tlsDir) {
        rmSync(tlsDir, { recursive: true, force: true })
      }
    })

    it('upgrades and echoes over wss:// (dev fallback accepts loopback)', async () => {
      if (!opensslAvailable || !tlsPort) {
        // openssl is required to generate the throwaway certificate for this test.
        expect(opensslAvailable).toBe(false)
        return
      }
      const token = issueToken('preview')
      const client = await connect(
        `wss://127.0.0.1:${tlsPort}/internal/roost/v1/sandboxes/sbx-1/preview/3000/ws`,
        { authorization: `Bearer ${token}` },
      ).catch(async (error) => {
        // `connect` uses rejectUnauthorized default true; retry trusting nothing.
        if ((error as Error).message.includes('self-signed')) {
          const relaxed = await openWebSocket(
            `wss://127.0.0.1:${tlsPort}/internal/roost/v1/sandboxes/sbx-1/preview/3000/ws`,
            { headers: { authorization: `Bearer ${token}` }, rejectUnauthorized: false },
          )
          clients.push(relaxed)
          return relaxed
        }
        throw error
      })

      await expect(echo(client, 'tls')).resolves.toBe('echo:tls')
      client.close()
    })
  })
})
