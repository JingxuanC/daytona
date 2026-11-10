/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, Get, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { INestApplication } from '@nestjs/common'
import { AddressInfo } from 'node:net'
import http from 'node:http'
import { INTERNAL_ROOST_GLOBAL_PREFIX_EXCLUDE, INTERNAL_ROOST_PATH } from './internal-roost.constants'
import { internalRoostIsolationMiddleware } from './internal-roost.isolation.middleware'
import { InternalRoostServerService, isPrivateOrLoopbackAddress } from './internal-roost.server.service'

@Controller(INTERNAL_ROOST_PATH)
class InternalPingController {
  @Get('ping')
  ping() {
    return { ok: true }
  }

  @Post('echo')
  echo(@Body() body: any) {
    return body
  }
}

@Module({ controllers: [InternalPingController] })
class InternalPingModule {}

function createConfigService(overrides: Record<string, any> = {}): any {
  const internalRoost = {
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
  }
  const values: Record<string, any> = {
    production: false,
    internalRoost,
    ...overrides,
  }
  return { get: (key: string) => values[key] }
}

function httpGet(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
      let body = ''
      response.on('data', (chunk) => {
        body += chunk.toString()
      })
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }))
    })
    request.on('error', reject)
  })
}

function httpPostJson(port: number, path: string, payload: unknown): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const request = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk.toString()
        })
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }))
      },
    )
    request.on('error', reject)
    request.write(data)
    request.end()
  })
}

describe('Internal Roost listener wiring', () => {
  let app: INestApplication
  let publicPort: number
  let service: InternalRoostServerService
  let internalPort: number

  beforeAll(async () => {
    app = await NestFactory.create(InternalPingModule, { logger: false })
    // Mirrors main.ts: internal routes keep `/internal/roost/...` while every other
    // controller keeps the `/api` prefix, and the public port never serves them.
    app.setGlobalPrefix('api', { exclude: INTERNAL_ROOST_GLOBAL_PREFIX_EXCLUDE })
    app.use(internalRoostIsolationMiddleware)
    await app.listen(0, '127.0.0.1')
    publicPort = (app.getHttpServer().address() as AddressInfo).port

    service = new InternalRoostServerService(createConfigService())
    await service.start(app)
    internalPort = service.getAddress()?.port as number
  })

  afterAll(async () => {
    await service?.onApplicationShutdown()
    await app?.close()
  })

  it('serves the internal API on the dedicated listener (dev loopback fallback)', async () => {
    const response = await httpGet(internalPort, '/internal/roost/v1/ping')
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
  })

  it('parses JSON bodies on the internal listener', async () => {
    const response = await httpPostJson(internalPort, '/internal/roost/v1/echo', { hello: 'roost' })
    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body)).toEqual({ hello: 'roost' })
  })

  it('answers unknown internal routes with 404 (never reaches the public app)', async () => {
    const response = await httpGet(internalPort, '/internal/roost/v1/unknown')
    expect(response.statusCode).toBe(404)
  })

  it('does not expose any other route on the internal listener', async () => {
    const response = await httpGet(internalPort, '/api/ping')
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body).error.code).toBe('not_found')
  })

  it('does not serve the internal API on the public API port', async () => {
    const response = await httpGet(publicPort, '/internal/roost/v1/ping')
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body).error.code).toBe('not_found')
  })

  it('keeps the regular /api prefix working', async () => {
    const response = await httpGet(publicPort, '/api/internal-roost-missing')
    expect(response.statusCode).toBe(404)
  })
})

describe('isPrivateOrLoopbackAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.10', true],
    ['169.254.1.1', true],
    ['fd00::1', true],
    ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false],
    ['172.32.0.1', false],
    ['1.1.1.1', false],
    ['2001:4860:4860::8888', false],
  ])('classifies %s as private=%s', (address, expected) => {
    expect(isPrivateOrLoopbackAddress(address)).toBe(expected)
  })
})
