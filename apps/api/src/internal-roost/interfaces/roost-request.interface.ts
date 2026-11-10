/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Request } from 'express'
import { RoostJwtClaims } from './roost-jwt-claims.interface'

/** Identity extracted from the mTLS client certificate (or the dev loopback fallback). */
export interface RoostMtlsIdentity {
  /** Certificate subject/SAN used as the JWT `sub` claim. */
  subject: string
  fingerprint?: string
}

/** Authenticated Roost caller attached to the request by the guards. */
export interface RoostAuthContext {
  aud: string
  orgId: string | null
  sandboxId: string | null
  scope: string[]
  jti: string
  subject: string
  claims: RoostJwtClaims
}

/**
 * Express request handled by the internal Roost listener.
 *
 * `roostInternalListener` is set by the internal HTTPS listener dispatcher; it is
 * never set for requests that arrive on the public API port.
 */
export interface RoostInternalRequest extends Request {
  roostInternalListener?: boolean
  roostMtls?: RoostMtlsIdentity
  roostAuth?: RoostAuthContext
}

export function getRoostInternalRequest(req: Request): RoostInternalRequest {
  return req as RoostInternalRequest
}

/** Returns the organization bound to the credential (guards guarantee it exists). */
export function requireRoostOrgId(req: Request): string {
  const auth = getRoostAuthContext(req)
  if (!auth.orgId) {
    throw new ForbiddenException('Credential is not bound to an organization')
  }
  return auth.orgId
}

export function getRoostAuthContext(req: Request): RoostAuthContext {
  const auth = getRoostInternalRequest(req).roostAuth
  if (!auth) {
    throw new UnauthorizedException('Roost credential is not attached to the request')
  }
  return auth
}
