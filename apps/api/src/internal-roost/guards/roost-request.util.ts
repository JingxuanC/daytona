/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { UnauthorizedException } from '@nestjs/common'
import { Request } from 'express'
import { getRoostInternalRequest } from '../interfaces/roost-request.interface'

/** Extracts the bearer token from the `Authorization` header. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers?.authorization
  if (!header || typeof header !== 'string') {
    return null
  }
  const [scheme, value] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) {
    return null
  }
  return value.trim() || null
}

/**
 * Requires the request to arrive on the dedicated internal listener.
 *
 * The public API port 404s every `/internal/roost/**` request in
 * `internalRoostIsolationMiddleware`, this is only a defense-in-depth check for the
 * case where the internal controller is (mis)configured on the public app.
 */
export function assertInternalRoostListener(request: Request): void {
  if (!getRoostInternalRequest(request).roostInternalListener) {
    throw new UnauthorizedException('Internal Roost API is only served by the internal listener')
  }
}
