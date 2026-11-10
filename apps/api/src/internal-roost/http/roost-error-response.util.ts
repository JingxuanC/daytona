/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { IncomingMessage } from 'node:http'
import { INTERNAL_ROOST_REQUEST_ID_HEADER } from '../internal-roost.constants'

/**
 * Writes the internal Roost error envelope directly on a raw Node response.
 *
 * Used by the data-plane proxy for failures that happen after the Nest exception
 * pipeline (upstream connection errors), so the shape stays identical to
 * `RoostExceptionsFilter`.
 */
export function writeRoostErrorResponse(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  request: Pick<IncomingMessage, 'headers'>,
): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const headerRequestId = request.headers[INTERNAL_ROOST_REQUEST_ID_HEADER]
  const requestId =
    typeof headerRequestId === 'string' && headerRequestId.trim().length > 0 ? headerRequestId.trim() : randomUUID()

  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ error: { code, message, request_id: requestId } }))
}
