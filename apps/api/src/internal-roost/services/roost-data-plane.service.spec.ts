/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import {
  buildDataPlaneUpstreamUrl,
  getQueryParam,
  isDataPlanePath,
  removeQueryParam,
  resolvePreviewPort,
  RoostDataPlaneService,
} from './roost-data-plane.service'
import {
  buildUpstreamRequestHeaders,
  forwardUpstreamResponse,
  serializeParsedRequestBody,
} from './roost-data-plane-proxy.service'

const RUNNER_PROXY_URL = 'http://runner.internal:2280'
const SANDBOX_ID = '72f0f1c2-9f0a-4d31-9d4a-6e4a5f2a1b3c'

describe('buildDataPlaneUpstreamUrl', () => {
  it('maps toolbox paths onto the runner toolbox endpoint', () => {
    const built = buildDataPlaneUpstreamUrl({
      kind: 'toolbox',
      sandboxId: SANDBOX_ID,
      runnerProxyUrl: RUNNER_PROXY_URL,
      originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox/process/execute?timeout=10`,
    })
    expect(built.url).toBe(
      `${RUNNER_PROXY_URL}/sandboxes/${SANDBOX_ID}/toolbox/process/execute?timeout=10`,
    )
    expect(built.port).toBeUndefined()
  })

  it('keeps a trailing slash and a bare toolbox root', () => {
    expect(
      buildDataPlaneUpstreamUrl({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        runnerProxyUrl: RUNNER_PROXY_URL,
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox/`,
      }).url,
    ).toBe(`${RUNNER_PROXY_URL}/sandboxes/${SANDBOX_ID}/toolbox/`)
    expect(
      buildDataPlaneUpstreamUrl({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        runnerProxyUrl: RUNNER_PROXY_URL,
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox`,
      }).url,
    ).toBe(`${RUNNER_PROXY_URL}/sandboxes/${SANDBOX_ID}/toolbox`)
  })

  it('maps preview with the numeric first path segment as the port', () => {
    const built = buildDataPlaneUpstreamUrl({
      kind: 'preview',
      sandboxId: SANDBOX_ID,
      runnerProxyUrl: RUNNER_PROXY_URL,
      originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/preview/3000/app?q=1`,
    })
    expect(built.port).toBe(3000)
    expect(built.url).toBe(
      `${RUNNER_PROXY_URL}/sandboxes/${SANDBOX_ID}/toolbox/proxy/3000/app?q=1`,
    )
  })

  it('prefers ?port= and consumes it from the forwarded query', () => {
    const built = buildDataPlaneUpstreamUrl({
      kind: 'preview',
      sandboxId: SANDBOX_ID,
      runnerProxyUrl: RUNNER_PROXY_URL,
      originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/preview/app?port=8080&q=1`,
    })
    expect(built.port).toBe(8080)
    expect(built.url).toBe(
      `${RUNNER_PROXY_URL}/sandboxes/${SANDBOX_ID}/toolbox/proxy/8080/app?q=1`,
    )
  })

  it('rejects preview without a port', () => {
    expect(() =>
      buildDataPlaneUpstreamUrl({
        kind: 'preview',
        sandboxId: SANDBOX_ID,
        runnerProxyUrl: RUNNER_PROXY_URL,
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/preview/app`,
      }),
    ).toThrow(BadRequestException)
  })

  it('rejects a mismatched sandbox id or kind', () => {
    expect(() =>
      buildDataPlaneUpstreamUrl({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        runnerProxyUrl: RUNNER_PROXY_URL,
        originalUrl: '/internal/roost/v1/sandboxes/other/toolbox/x',
      }),
    ).toThrow(BadRequestException)
    expect(() =>
      buildDataPlaneUpstreamUrl({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        runnerProxyUrl: RUNNER_PROXY_URL,
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/preview/3000`,
      }),
    ).toThrow(BadRequestException)
  })
})

describe('preview/query helpers', () => {
  it('resolves the port from query or path', () => {
    expect(resolvePreviewPort('port=9000', '/app')).toEqual({ port: 9000, path: '/app' })
    expect(resolvePreviewPort('', '/3000')).toEqual({ port: 3000, path: '' })
  })

  it('rejects invalid ports', () => {
    expect(() => resolvePreviewPort('port=0', '/')).toThrow(BadRequestException)
    expect(() => resolvePreviewPort('port=abc', '/')).toThrow(BadRequestException)
    expect(() => resolvePreviewPort('', '/70000')).toThrow(BadRequestException)
  })

  it('parses and removes query parameters without re-encoding the rest', () => {
    expect(getQueryParam('a=1&port=3000&b=2', 'port')).toBe('3000')
    expect(getQueryParam('a=1', 'port')).toBeNull()
    expect(removeQueryParam('a=1&port=3000&b=2', 'port')).toBe('a=1&b=2')
  })

  it('detects internal data-plane paths', () => {
    expect(isDataPlanePath('/internal/roost/v1/sandboxes/x/toolbox')).toBe(true)
    expect(isDataPlanePath('/api/sandboxes/x/toolbox')).toBe(false)
  })
})

describe('RoostDataPlaneService.resolveTarget', () => {
  const sandbox = {
    id: SANDBOX_ID,
    organizationId: 'org-1',
    state: SandboxState.STARTED,
    runnerId: 'runner-1',
  }
  const runner = { id: 'runner-1', proxyUrl: RUNNER_PROXY_URL, apiKey: 'runner-key' }

  function buildService(overrides: { sandbox?: unknown; runner?: unknown } = {}) {
    const sandboxService = { findOne: jest.fn().mockResolvedValue(overrides.sandbox ?? sandbox) }
    const runnerService = { findOne: jest.fn().mockResolvedValue(overrides.runner ?? runner) }
    return {
      service: new RoostDataPlaneService(sandboxService as never, runnerService as never),
      sandboxService,
      runnerService,
    }
  }

  it('builds the runner target and injects the runner credential', async () => {
    const { service } = buildService()
    const target = await service.resolveTarget({
      kind: 'toolbox',
      sandboxId: SANDBOX_ID,
      orgId: 'org-1',
      originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox/process/execute`,
    })
    expect(target.targetUrl).toBe(
      `${RUNNER_PROXY_URL}/sandboxes/${SANDBOX_ID}/toolbox/process/execute`,
    )
    expect(target.upstreamHeaders).toEqual({ 'X-Daytona-Authorization': 'Bearer runner-key' })
  })

  it('hides sandboxes of other organizations', async () => {
    const { service } = buildService()
    await expect(
      service.resolveTarget({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        orgId: 'org-2',
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox`,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects sandboxes that are not started', async () => {
    const { service } = buildService({ sandbox: { ...sandbox, state: SandboxState.STOPPED } })
    await expect(
      service.resolveTarget({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        orgId: 'org-1',
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox`,
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects sandboxes without a runner or runner proxy URL', async () => {
    const noRunner = buildService({ sandbox: { ...sandbox, runnerId: null } })
    await expect(
      noRunner.service.resolveTarget({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        orgId: 'org-1',
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox`,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException)

    const noProxy = buildService({ runner: { ...runner, proxyUrl: null } })
    await expect(
      noProxy.service.resolveTarget({
        kind: 'toolbox',
        sandboxId: SANDBOX_ID,
        orgId: 'org-1',
        originalUrl: `/internal/roost/v1/sandboxes/${SANDBOX_ID}/toolbox`,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})

describe('proxy helpers', () => {
  it('strips client credentials and hop-by-hop headers, injects the runner key', () => {
    const headers = buildUpstreamRequestHeaders(
      {
        host: 'internal.local',
        authorization: 'Bearer market-credential',
        'x-daytona-authorization': 'Bearer leaked',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'x-request-id': 'req-1',
      },
      { 'X-Daytona-Authorization': 'Bearer runner-key' },
      'edge.example.com',
    )
    expect(headers.authorization).toBeUndefined()
    expect(headers['x-daytona-authorization']).toBe('Bearer runner-key')
    expect(headers.connection).toBeUndefined()
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-forwarded-host']).toBe('edge.example.com')
  })

  it('re-serializes an already parsed JSON body with a fixed length', () => {
    const headers: Record<string, string> = {}
    const body = serializeParsedRequestBody(
      { body: { command: 'echo hi' }, headers: { 'content-type': 'application/json' } } as never,
      headers,
    )
    expect(body?.toString()).toBe('{"command":"echo hi"}')
    expect(headers['content-length']).toBe(String(body?.length))
  })

  it('flushes upstream headers before piping the body', () => {
    const response = {
      headersSent: false,
      statusCode: 0,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      pipe: jest.fn(),
    }
    const upstream = {
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream', connection: 'keep-alive' },
      pipe: jest.fn(),
    }
    forwardUpstreamResponse(upstream as never, response as never, { headers: {} })
    expect(response.statusCode).toBe(200)
    expect(response.setHeader).toHaveBeenCalledWith('content-type', 'text/event-stream')
    expect(response.flushHeaders).toHaveBeenCalled()
    expect(upstream.pipe).toHaveBeenCalledWith(response)
  })
})
