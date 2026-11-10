/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { RunnerService } from '../../sandbox/services/runner.service'
import { SandboxService } from '../../sandbox/services/sandbox.service'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import { INTERNAL_ROOST_ROOT_PREFIX } from '../internal-roost.constants'
import {
  BuiltDataPlaneUpstreamUrl,
  ResolveDataPlaneTargetParams,
  ResolvedDataPlaneTarget,
  RoostDataPlaneKind,
} from '../dto/data-plane.dto'

const SANDBOX_ROUTE_REGEX = /^\/internal\/roost\/v1\/sandboxes\/([^/]+)\/(toolbox|preview)(.*)$/

/**
 * Resolves a data-plane request to its runner and builds the upstream URL.
 *
 * The upstream conventions are the same ones the fork's public data plane uses
 * (`apps/proxy`): the runner is addressed through `runner.proxyUrl` with an
 * `X-Daytona-Authorization` header, toolbox traffic goes to
 * `/sandboxes/{id}/toolbox{rest}` and preview traffic to
 * `/sandboxes/{id}/toolbox/proxy/{port}{rest}`.
 */
@Injectable()
export class RoostDataPlaneService {
  private readonly logger = new Logger(RoostDataPlaneService.name)

  constructor(
    private readonly sandboxService: SandboxService,
    private readonly runnerService: RunnerService,
  ) {}

  async resolveTarget(params: ResolveDataPlaneTargetParams): Promise<ResolvedDataPlaneTarget> {
    const sandbox = await this.sandboxService.findOne(params.sandboxId)

    // Never disclose sandboxes of other organizations.
    if (sandbox.organizationId !== params.orgId) {
      throw new NotFoundException(`Sandbox ${params.sandboxId} not found`)
    }

    if (sandbox.state !== SandboxState.STARTED) {
      throw new ConflictException(`Sandbox ${params.sandboxId} is not started (state: ${sandbox.state})`)
    }

    if (!sandbox.runnerId) {
      throw new BadGatewayException(`Sandbox ${params.sandboxId} has no runner assigned`)
    }

    const runner = await this.runnerService.findOne(sandbox.runnerId)
    if (!runner) {
      throw new BadGatewayException(`Runner for sandbox ${params.sandboxId} is not available`)
    }
    if (!runner.proxyUrl) {
      throw new BadGatewayException(`Runner for sandbox ${params.sandboxId} has no proxy URL configured`)
    }

    const built = buildDataPlaneUpstreamUrl({
      kind: params.kind,
      sandboxId: params.sandboxId,
      runnerProxyUrl: runner.proxyUrl,
      originalUrl: params.originalUrl,
    })

    return {
      kind: params.kind,
      sandboxId: params.sandboxId,
      runnerId: runner.id,
      targetUrl: built.url,
      upstreamHeaders: {
        'X-Daytona-Authorization': `Bearer ${runner.apiKey}`,
      },
    }
  }
}

/**
 * Builds the runner upstream URL from the raw internal request URL.
 *
 * - toolbox: `{runner.proxyUrl}/sandboxes/{id}/toolbox{rest}`
 * - preview: `{runner.proxyUrl}/sandboxes/{id}/toolbox/proxy/{port}{rest}`
 *   - port precedence: `?port=` query parameter, then the first numeric path
 *     segment (`/preview/3000/app`); neither → `400 invalid_request`.
 *   - the consumed `port` query parameter is not forwarded upstream.
 *
 * Raw path/query strings are preserved (no re-encoding of the proxied path).
 */
export function buildDataPlaneUpstreamUrl(params: {
  kind: RoostDataPlaneKind
  sandboxId: string
  runnerProxyUrl: string
  originalUrl: string
}): BuiltDataPlaneUpstreamUrl {
  const { kind, sandboxId, runnerProxyUrl, originalUrl } = params

  const proxyBase = runnerProxyUrl.replace(/\/+$/, '')
  let parsedBase: URL
  try {
    parsedBase = new URL(proxyBase)
  } catch {
    throw new BadGatewayException('Runner proxy URL is not a valid URL')
  }
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
    throw new BadGatewayException(`Unsupported runner proxy URL protocol: ${parsedBase.protocol}`)
  }
  if (parsedBase.pathname && parsedBase.pathname !== '/') {
    throw new BadGatewayException('Runner proxy URL must not contain a path')
  }

  const match = SANDBOX_ROUTE_REGEX.exec(originalUrl)
  if (!match) {
    throw new BadRequestException('Invalid data-plane request path')
  }
  const routeSandboxId = match[1]
  const routeKind = match[2] as RoostDataPlaneKind
  if (decodeURIComponent(routeSandboxId) !== sandboxId) {
    throw new BadRequestException('Sandbox id in the path does not match the authenticated sandbox')
  }
  if (routeKind !== kind) {
    throw new BadRequestException('Data-plane route kind does not match the requested operation')
  }

  const rawPathAfterKind = match[3] ?? ''
  const queryIndex = rawPathAfterKind.indexOf('?')
  const rawRestPath = queryIndex >= 0 ? rawPathAfterKind.slice(0, queryIndex) : rawPathAfterKind
  const rawQuery =
    queryIndex >= 0 ? rawPathAfterKind.slice(queryIndex + 1) : originalUrl.includes('?') ? originalUrl.split('?')[1] : ''

  const encodedSandboxId = encodeURIComponent(sandboxId)

  let targetPath: string
  let queryWithoutPort = rawQuery
  let port: number | undefined

  if (kind === 'toolbox') {
    targetPath = `${proxyBase}/sandboxes/${encodedSandboxId}/toolbox${rawRestPath}`
  } else {
    const portResolution = resolvePreviewPort(rawQuery, rawRestPath)
    port = portResolution.port
    queryWithoutPort = removeQueryParam(rawQuery, 'port')
    targetPath = `${proxyBase}/sandboxes/${encodedSandboxId}/toolbox/proxy/${portResolution.port}${portResolution.path}`
  }

  let url: string
  try {
    url = new URL(targetPath, `${parsedBase.protocol}//${parsedBase.host}`).toString()
  } catch {
    throw new BadRequestException('Unable to build the upstream runner URL')
  }

  const finalUrl = queryWithoutPort.length > 0 ? `${url}${url.includes('?') ? '&' : '?'}${queryWithoutPort}` : url
  return { url: finalUrl, port }
}

/**
 * Resolves the preview port.
 *
 * `?port=` wins; otherwise the first numeric path segment is consumed
 * (`/preview/3000/foo` → port 3000, rest `/foo`). Returns a 400 when neither
 * yields a valid port.
 */
export function resolvePreviewPort(
  rawQuery: string,
  rawRestPath: string,
): { port: number; path: string } {
  const queryPort = getQueryParam(rawQuery, 'port')
  if (queryPort !== null) {
    const port = parsePort(queryPort)
    if (port === null) {
      throw new BadRequestException(`Invalid port query parameter: ${queryPort}`)
    }
    return { port, path: normalizeRestPath(rawRestPath) }
  }

  const match = /^\/(\d{1,5})(?:\/(.*))?$/.exec(rawRestPath)
  if (match) {
    const port = parsePort(match[1])
    if (port === null) {
      throw new BadRequestException(`Invalid port in path: ${match[1]}`)
    }
    const remaining = match[2] ? `/${match[2]}` : ''
    return { port, path: remaining }
  }

  throw new BadRequestException(
    'Preview port is required: use the `port` query parameter or put the port as the first path segment',
  )
}

function parsePort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) {
    return null
  }
  const port = Number(value)
  return port >= 1 && port <= 65535 ? port : null
}

function normalizeRestPath(restPath: string): string {
  if (!restPath || restPath === '/') {
    return ''
  }
  return restPath.startsWith('/') ? restPath : `/${restPath}`
}

/** Removes one query parameter from a raw query string, preserving everything else. */
export function removeQueryParam(rawQuery: string, name: string): string {
  if (!rawQuery) {
    return ''
  }
  const parts = rawQuery.split('&').filter((part) => part.length > 0)
  const kept = parts.filter((part) => decodeURIComponent(part.split('=')[0]) !== name)
  return kept.join('&')
}

/** Both response/request helper shared by the proxy transport. */
export function getQueryParam(rawQuery: string, name: string): string | null {
  if (!rawQuery) {
    return null
  }
  for (const part of rawQuery.split('&')) {
    if (part.length === 0) {
      continue
    }
    const separator = part.indexOf('=')
    const rawName = separator >= 0 ? part.slice(0, separator) : part
    if (decodeURIComponent(rawName) === name) {
      return separator >= 0 ? decodeURIComponent(part.slice(separator + 1)) : ''
    }
  }
  return null
}

/** True when the URL is a data-plane route of this internal API. */
export function isDataPlanePath(url: string): boolean {
  const path = url.split('?')[0]
  return path.startsWith(`${INTERNAL_ROOST_ROOT_PREFIX}v1/sandboxes/`)
}
