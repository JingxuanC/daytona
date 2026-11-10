/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, Logger } from '@nestjs/common'
import { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Response } from 'express'
import { HOP_BY_HOP_HEADERS, ResolvedDataPlaneTarget, RoostDataPlaneKind } from '../dto/data-plane.dto'
import { getRoostAuthContext, RoostInternalRequest } from '../interfaces/roost-request.interface'
import { writeRoostErrorResponse } from '../http/roost-error-response.util'
import { RoostDataPlaneService } from './roost-data-plane.service'

const MAX_REDIRECT_HEADER = 'x-daytona-no-redirect'

/**
 * HTTP reverse proxy for the internal data plane.
 *
 * Raw `node:http`/`node:https` streams are piped in both directions so SSE,
 * chunked and binary payloads are never buffered. WebSocket upgrades are not
 * handled here (see docs/design/internal-roost.md §6.2 - M3.1): the internal
 * listener has no pre-upgrade authorization hook yet.
 */
@Injectable()
export class RoostDataPlaneProxyService {
  private readonly logger = new Logger(RoostDataPlaneProxyService.name)

  constructor(private readonly dataPlaneService: RoostDataPlaneService) {}

  async proxy(request: RoostInternalRequest, response: Response, kind: RoostDataPlaneKind): Promise<void> {
    const auth = getRoostAuthContext(request)
    if (!auth.orgId) {
      throw new (await import('@nestjs/common')).ForbiddenException('Credential is not bound to an organization')
    }

    const sandboxId = request.params?.sandboxId as string | undefined
    if (!sandboxId) {
      throw new (await import('@nestjs/common')).BadRequestException('sandboxId is required')
    }

    const target = await this.dataPlaneService.resolveTarget({
      kind,
      sandboxId,
      orgId: auth.orgId,
      originalUrl: request.originalUrl || request.url,
    })

    await this.forward(request, response, target)
  }

  private forward(
    request: RoostInternalRequest,
    response: Response,
    target: ResolvedDataPlaneTarget,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let targetUrl: URL
      try {
        targetUrl = new URL(target.targetUrl)
      } catch {
        writeRoostErrorResponse(response, 502, 'upstream_unavailable', 'Invalid upstream runner URL', request)
        resolve()
        return
      }

      const headers = buildUpstreamRequestHeaders(request.headers, target.upstreamHeaders, request.headers.host)
      const parsedBody = serializeParsedRequestBody(request, headers)

      const transport = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest
      const proxyRequest = transport(
        {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname,
          port: targetUrl.port || undefined,
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method: request.method,
          headers,
        },
        (proxyResponse: IncomingMessage) => {
          forwardUpstreamResponse(proxyResponse, response, request)
          proxyResponse.on('error', (error) => {
            this.logger.warn(`Upstream response error for sandbox ${target.sandboxId}: ${error.message}`)
            response.destroy(error)
          })
          proxyResponse.on('end', () => resolve())
        },
      )

      proxyRequest.on('error', (error) => {
        this.logger.warn(`Upstream request error for sandbox ${target.sandboxId}: ${error.message}`)
        writeRoostErrorResponse(
          response,
          502,
          'upstream_unavailable',
          `Runner upstream is unavailable: ${error.message}`,
          request,
        )
        resolve()
      })

      // The client went away: stop the upstream request too.
      request.on('aborted', () => proxyRequest.destroy())
      request.on('close', () => {
        if (!proxyRequest.writableEnded) {
          proxyRequest.destroy()
        }
      })
      response.on('close', () => {
        if (!proxyRequest.destroyed) {
          proxyRequest.destroy()
        }
        resolve()
      })

      if (parsedBody !== undefined) {
        proxyRequest.end(parsedBody)
      } else {
        ;(request as unknown as IncomingMessage).pipe(proxyRequest)
      }
    })
  }
}

/**
 * Builds the headers sent to the runner:
 * - client `Authorization` / `X-Daytona-Authorization` are stripped (never forward
 *   the market credential to a runner),
 * - hop-by-hop headers are removed (Node recomputes them),
 * - the runner API key is injected as `X-Daytona-Authorization`,
 * - `X-Forwarded-Host` mirrors the public data-plane request host (parity with the
 *   fork's Go proxy).
 */
export function buildUpstreamRequestHeaders(
  incoming: IncomingHttpHeaders,
  overrides: Record<string, string>,
  originalHost?: string,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(incoming)) {
    const lowerKey = key.toLowerCase()
    if (value === undefined) {
      continue
    }
    if (lowerKey === 'host' || lowerKey === 'authorization' || lowerKey === 'x-daytona-authorization') {
      continue
    }
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue
    }
    headers[key] = value
  }

  for (const [key, value] of Object.entries(overrides)) {
    headers[key.toLowerCase()] = value
  }
  if (originalHost) {
    headers['x-forwarded-host'] = originalHost
  }
  return headers
}

/**
 * Express has already parsed JSON/urlencoded bodies before the controller runs, so
 * the request stream is consumed. Re-serialize the parsed body and fix
 * `content-length`; everything else (multipart uploads, binary) is streamed as-is.
 */
export function serializeParsedRequestBody(
  request: IncomingMessage & { body?: unknown },
  headers: OutgoingHttpHeaders,
): Buffer | undefined {
  const body = request.body
  if (body === undefined || body === null || Buffer.isBuffer(body)) {
    return undefined
  }
  if (typeof body !== 'object') {
    return undefined
  }

  const contentType = String(request.headers['content-type'] ?? '').toLowerCase()
  let serialized: Buffer
  if (contentType.includes('application/x-www-form-urlencoded')) {
    serialized = Buffer.from(new URLSearchParams(body as Record<string, string>).toString())
  } else {
    serialized = Buffer.from(JSON.stringify(body))
    if (!contentType.includes('application/json')) {
      headers['content-type'] = 'application/json'
    }
  }

  headers['content-length'] = String(serialized.length)
  delete headers['transfer-encoding']
  return serialized
}

/** Streams the runner response back without buffering (SSE / chunked / binary safe). */
export function forwardUpstreamResponse(
  proxyResponse: IncomingMessage,
  response: ServerResponse,
  request: Pick<IncomingMessage, 'headers'>,
): void {
  if (response.headersSent) {
    response.destroy()
    return
  }

  const statusCode = proxyResponse.statusCode ?? 502
  response.statusCode = statusCode
  if (proxyResponse.statusMessage) {
    response.statusMessage = proxyResponse.statusMessage
  }

  for (const [key, value] of Object.entries(proxyResponse.headers)) {
    const lowerKey = key.toLowerCase()
    if (value === undefined || HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue
    }
    try {
      response.setHeader(key, value)
    } catch (error) {
      // Invalid upstream header - keep proxying the body, never fail the stream.
      void request
      void error
    }
  }

  // Send headers immediately so SSE clients see the response before the first event.
  response.flushHeaders?.()
  proxyResponse.pipe(response)
}

/** Header used by the fork's public proxy to skip redirects; kept for documentation parity. */
export { MAX_REDIRECT_HEADER }
