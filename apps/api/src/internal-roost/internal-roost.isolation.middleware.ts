/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { NextFunction, Request, Response } from 'express'
import { isRoostInternalPath } from './internal-roost.constants'
import { getRoostInternalRequest } from './interfaces/roost-request.interface'

/**
 * Keeps the internal API off the public API port.
 *
 * Both listeners share the same Nest express instance (so DI, pipes and filters are
 * reused), but only requests dispatched by `InternalRoostServerService` carry
 * `roostInternalListener`. Everything else that lands on `0.0.0.0:PORT` with an
 * `/internal/roost/**` path is answered as 404 before any controller/guard runs.
 */
export function internalRoostIsolationMiddleware(request: Request, response: Response, next: NextFunction): void {
  const path = (request.originalUrl || request.url || '').split('?')[0]

  if (isRoostInternalPath(path) && !getRoostInternalRequest(request).roostInternalListener) {
    response.status(404).json({
      error: {
        code: 'not_found',
        message: 'Not found',
        request_id: (request.headers?.['x-request-id'] as string) || '',
      },
    })
    return
  }

  next()
}
