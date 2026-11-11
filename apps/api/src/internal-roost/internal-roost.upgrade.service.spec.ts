/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common'
import { IncomingMessage } from 'node:http'
import { Duplex } from 'node:stream'
import { RoostRevokedCredential } from './entities/roost-revoked-credential.entity'
import { RoostKeyService } from './services/roost-key.service'
import { RoostCredentialsService } from './services/roost-credentials.service'
import {
  buildUpgradeRequestHeaders,
  formatUpgradeResponseHead,
  getBearerToken,
  isWebSocketUpgrade,
  parseDataPlaneUpgradeUrl,
  RoostUpgradeRejection,
  InternalRoostUpgradeService,
} from './internal-roost.upgrade.service'

function setConfigPath(target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] = current[parts[index]] ?? {}
    current = current[parts[index]]
  }
  current[parts[parts.length - 1]] = value
}

export function createUpgradeTestConfigService(overrides: Record<string, unknown> = {}): any {
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

function createRevocationRepository(): any {
  const rows = new Map<string, RoostRevokedCredential>()
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => rows.get(where.jti) ?? null),
    save: jest.fn(async (row: RoostRevokedCredential) => {
      rows.set(row.jti, row)
      return row
    }),
    delete: jest.fn(async () => ({ affected: 0 })),
  }
}

function createCredentialsService(): { credentials: RoostCredentialsService; repo: any; config: any } {
  const config = createUpgradeTestConfigService()
  const keyService = new RoostKeyService(config)
  keyService.onModuleInit()
  const repo = createRevocationRepository()
  return { credentials: new RoostCredentialsService(keyService, config, repo), repo, config }
}

class FakeSocket {
  written: Buffer[] = []
  ended = false
  destroyed = false
  remoteAddress = '127.0.0.1'

  write(data: unknown): boolean {
    this.written.push(Buffer.from(data as any))
    return true
  }

  end(data?: unknown): this {
    if (data !== undefined) {
      this.write(data)
    }
    this.ended = true
    return this
  }

  destroy(): void {
    this.destroyed = true
  }

  on(): this {
    return this
  }

  get text(): string {
    return Buffer.concat(this.written).toString('utf8')
  }
}

function createRequest(
  url: string,
  headers: Record<string, string | string[] | undefined>,
): IncomingMessage {
  return { url, method: 'GET', headers } as unknown as IncomingMessage
}

const WS_HEADERS = { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }

describe('parseDataPlaneUpgradeUrl', () => {
  it('parses preview/toolbox upgrade paths with rest and query', () => {
    expect(
      parseDataPlaneUpgradeUrl('/internal/roost/v1/sandboxes/sbx-1/preview/3000/ws?x=1&port=3000'),
    ).toEqual({
      kind: 'preview',
      sandboxId: 'sbx-1',
      restPath: '/3000/ws',
      rawQuery: 'x=1&port=3000',
    })
    expect(parseDataPlaneUpgradeUrl('/internal/roost/v1/sandboxes/sbx-1/toolbox/api/ws')).toEqual({
      kind: 'toolbox',
      sandboxId: 'sbx-1',
      restPath: '/api/ws',
      rawQuery: '',
    })
  })

  it('parses the route root and URL-encoded sandbox ids', () => {
    expect(parseDataPlaneUpgradeUrl('/internal/roost/v1/sandboxes/sbx-1/toolbox')).toEqual({
      kind: 'toolbox',
      sandboxId: 'sbx-1',
      restPath: '',
      rawQuery: '',
    })
    expect(parseDataPlaneUpgradeUrl('/internal/roost/v1/sandboxes/sbx%2D1/preview/8080')?.sandboxId).toBe('sbx-1')
  })

  it('rejects everything outside the two data-plane route families', () => {
    expect(parseDataPlaneUpgradeUrl(undefined)).toBeNull()
    expect(parseDataPlaneUpgradeUrl('/api/health')).toBeNull()
    expect(parseDataPlaneUpgradeUrl('/internal/roost/v1/runners/r1')).toBeNull()
    expect(parseDataPlaneUpgradeUrl('/internal/roost/v1/sandboxes/sbx-1/other/x')).toBeNull()
  })
})

describe('WebSocket upgrade helpers', () => {
  it('detects a real WebSocket handshake', () => {
    expect(isWebSocketUpgrade(WS_HEADERS)).toBe(true)
    expect(isWebSocketUpgrade({ connection: 'Upgrade' })).toBe(false)
    expect(isWebSocketUpgrade({ upgrade: 'h2c' })).toBe(false)
  })

  it('extracts the bearer token', () => {
    expect(getBearerToken({ authorization: 'Bearer abc.def' })).toBe('abc.def')
    expect(getBearerToken({ authorization: 'bearer abc' })).toBe('abc')
    expect(getBearerToken({})).toBeNull()
    expect(getBearerToken({ authorization: 'Basic abc' })).toBeNull()
  })

  it('forwards only the handshake headers and injects the runner credential', () => {
    const headers = buildUpgradeRequestHeaders(
      {
        ...WS_HEADERS,
        'sec-websocket-version': '13',
        'sec-websocket-protocol': 'vnc',
        origin: 'https://app.example',
        'user-agent': 'market-edge',
        authorization: 'Bearer market-token',
        cookie: 'session=secret',
      },
      'Bearer runner-key',
      'daytona.internal',
    )

    expect(headers.connection).toBe('Upgrade')
    expect(headers.upgrade).toBe('websocket')
    expect(headers['sec-websocket-key']).toBe(WS_HEADERS['sec-websocket-key'])
    expect(headers['sec-websocket-version']).toBe('13')
    expect(headers['sec-websocket-protocol']).toBe('vnc')
    expect(headers.origin).toBe('https://app.example')
    expect(headers['x-daytona-authorization']).toBe('Bearer runner-key')
    expect(headers['x-forwarded-host']).toBe('daytona.internal')
    expect(headers.authorization).toBeUndefined()
    expect(headers.cookie).toBeUndefined()
  })

  it('formats the 101 response head and drops entity headers', () => {
    const head = formatUpgradeResponseHead({
      headers: {
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-accept': 'abc',
        'transfer-encoding': 'chunked',
      },
    } as unknown as IncomingMessage)

    expect(head.startsWith('HTTP/1.1 101 Switching Protocols\r\n')).toBe(true)
    expect(head).toContain('sec-websocket-accept: abc')
    expect(head).not.toContain('transfer-encoding')
  })

  it('exposes a typed upgrade rejection', () => {
    const rejection = new RoostUpgradeRejection(403, 'forbidden', 'nope')
    expect(rejection.statusCode).toBe(403)
    expect(rejection.code).toBe('forbidden')
  })
})

describe('InternalRoostUpgradeService.handleUpgrade', () => {
  function createService(options: {
    config?: any
    credentials?: RoostCredentialsService
    dataPlane?: any
  } = {}) {
    const { credentials } = options.credentials
      ? { credentials: options.credentials }
      : createCredentialsService()
    const dataPlaneService = options.dataPlane ?? {
      resolveTarget: jest.fn(async () => ({
        kind: 'preview',
        sandboxId: 'sbx-1',
        runnerId: 'runner-1',
        targetUrl: 'http://127.0.0.1:1/sandboxes/sbx-1/toolbox/proxy/3000',
        upstreamHeaders: { 'X-Daytona-Authorization': 'Bearer runner-key' },
      })),
    }
    const service = new InternalRoostUpgradeService(
      credentials,
      dataPlaneService,
      options.config ?? createUpgradeTestConfigService(),
    )
    return { service, credentials, dataPlaneService }
  }

  it('destroys non data-plane upgrade paths without a response', async () => {
    const { service } = createService()
    const socket = new FakeSocket()

    await service.handleUpgrade(createRequest('/internal/roost/v1/runners/r1', WS_HEADERS), socket as unknown as Duplex, Buffer.alloc(0))

    expect(socket.destroyed).toBe(true)
    expect(socket.written).toHaveLength(0)
  })

  it('rejects a non-WebSocket upgrade with 400', async () => {
    const { service } = createService()
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', { connection: 'Upgrade' }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 400')
    expect(socket.text).toContain('"code":"invalid_request"')
  })

  it('rejects a missing bearer credential with 401', async () => {
    const { service } = createService()
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', WS_HEADERS),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 401')
    expect(socket.text).toContain('"code":"unauthorized"')
  })

  it('rejects a credential bound to another sandbox with 403', async () => {
    const { service, credentials } = createService()
    const token = credentials.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-other', scope: ['preview'] },
      'CN=market-edge',
    ).token
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', {
        ...WS_HEADERS,
        authorization: `Bearer ${token}`,
      }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 403')
    expect(socket.text).toContain('sandbox_id does not match')
  })

  it('rejects a credential without the required scope with 403', async () => {
    const { service, credentials } = createService()
    const token = credentials.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['toolbox'] },
      'CN=market-edge',
    ).token
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', {
        ...WS_HEADERS,
        authorization: `Bearer ${token}`,
      }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 403')
    expect(socket.text).toContain('Missing required data-plane scope: preview')
  })

  it('rejects a control-plane credential on the data plane with 403', async () => {
    const { service, credentials } = createService()
    const token = credentials.issueCredential(
      { aud: 'daytona-control', org_id: 'org-1', scope: ['sandbox:control'] },
      'CN=market-api',
    ).token
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/toolbox/api/ws', {
        ...WS_HEADERS,
        authorization: `Bearer ${token}`,
      }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 403')
    expect(socket.text).toContain('audience is not daytona-data')
  })

  it('rejects a revoked credential with 401', async () => {
    const { service, credentials } = createService()
    const issued = credentials.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['preview'] },
      'CN=market-edge',
    )
    await credentials.revokeCredential(issued.jti, { token: issued.token })
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', {
        ...WS_HEADERS,
        authorization: `Bearer ${issued.token}`,
      }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 401')
    expect(socket.text).toContain('revoked')
  })

  it('maps sandbox resolution failures to their HTTP status', async () => {
    const cases: Array<[unknown, string]> = [
      [new NotFoundException('Sandbox sbx-1 not found'), 'HTTP/1.1 404'],
      [new ConflictException('Sandbox sbx-1 is not started'), 'HTTP/1.1 409'],
      [new BadGatewayException('Runner for sandbox sbx-1 has no proxy URL configured'), 'HTTP/1.1 502'],
    ]

    for (const [error, expectedStatus] of cases) {
      const { credentials, config } = createCredentialsService()
      const token = credentials.issueCredential(
        { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['preview'] },
        'CN=market-edge',
      ).token
      const service = new InternalRoostUpgradeService(
        credentials,
        { resolveTarget: jest.fn(async () => Promise.reject(error)) } as any,
        config,
      )
      const socket = new FakeSocket()

      await service.handleUpgrade(
        createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', {
          ...WS_HEADERS,
          authorization: `Bearer ${token}`,
        }),
        socket as unknown as Duplex,
        Buffer.alloc(0),
      )

      expect(socket.text).toContain(expectedStatus)
    }
  })

  it('rejects non-loopback callers in the mTLS-less development fallback', async () => {
    const { service, credentials } = createService()
    const token = credentials.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['preview'] },
      'CN=market-edge',
    ).token
    const socket = new FakeSocket()
    socket.remoteAddress = '10.1.2.3'

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', {
        ...WS_HEADERS,
        authorization: `Bearer ${token}`,
      }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 403')
    expect(socket.text).toContain('loopback')
  })

  it('rejects upgrades in production when mTLS is not configured', async () => {
    const config = createUpgradeTestConfigService({ production: true })
    const { service, credentials } = createService({ config })
    const token = credentials.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['preview'] },
      'CN=market-edge',
    ).token
    const socket = new FakeSocket()

    await service.handleUpgrade(
      createRequest('/internal/roost/v1/sandboxes/sbx-1/preview/3000', {
        ...WS_HEADERS,
        authorization: `Bearer ${token}`,
      }),
      socket as unknown as Duplex,
      Buffer.alloc(0),
    )

    expect(socket.text).toContain('HTTP/1.1 403')
    expect(socket.text).toContain('requires mTLS')
  })
})
