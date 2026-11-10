/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/** Controller path prefix. Global `api` prefix is excluded for this prefix in `main.ts`. */
export const INTERNAL_ROOST_PATH = 'internal/roost/v1'

/**
 * Routes excluded from the global `/api` prefix. Applied in `main.ts` so the internal
 * API stays at `/internal/roost/v1/...` (contract) while every public route keeps `/api`.
 */
export const INTERNAL_ROOST_GLOBAL_PREFIX_EXCLUDE = ['internal/roost/{*path}']

/** Prefix used by the internal listener guard. */
export const INTERNAL_ROOST_ROOT_PREFIX = '/internal/roost/'

export const INTERNAL_ROOST_REQUEST_ID_HEADER = 'x-request-id'
export const INTERNAL_ROOST_IDEMPOTENCY_KEY_HEADER = 'idempotency-key'

export const ROOST_CONTROL_TTL_SECONDS = 900 // 15 minutes
export const ROOST_DATA_TTL_SECONDS = 300 // 5 minutes
export const ROOST_DEFAULT_CONTROL_TTL_SECONDS = ROOST_CONTROL_TTL_SECONDS
export const ROOST_DEFAULT_DATA_TTL_SECONDS = ROOST_DATA_TTL_SECONDS

/** Kept after a revocation, a JWT can never outlive this window (contract max TTL). */
export const ROOST_MAX_CREDENTIAL_TTL_SECONDS = ROOST_CONTROL_TTL_SECONDS

export const ROOST_TENANT_MAPPING_STATE_READY = 'ready'

export const ROOST_METADATA_SCOPES_KEY = 'roost:scopes'

/** Where internal tenant organizations come from (stored on `organization.createdBy`). */
export const ROOST_CREATED_BY_PREFIX = 'roost:tenant:'

/** Region id for a provider node. V1: one node owns exactly one CUSTOM region. */
export function roostRegionIdForNode(nodeExternalId: string): string {
  return `node_${nodeExternalId.replace(/-/g, '').toLowerCase()}`
}

export function isRoostInternalPath(path: string): boolean {
  return path === '/internal/roost' || path.startsWith(INTERNAL_ROOST_ROOT_PREFIX)
}

export function isLoopbackAddress(address?: string | null): boolean {
  if (!address) {
    return false
  }
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return normalized === '127.0.0.1' || normalized === '::1'
}

export function isLoopbackHost(host?: string | null): boolean {
  if (!host) {
    return false
  }
  return host === 'localhost' || isLoopbackAddress(host)
}
