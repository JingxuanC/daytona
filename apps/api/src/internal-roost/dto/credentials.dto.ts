/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/** Body of `POST /internal/roost/v1/credentials`. */
export interface IssueCredentialBody {
  aud?: string
  scope?: string[] | string
  org_id?: string | null
  orgId?: string | null
  sandbox_id?: string | null
  sandboxId?: string | null
  ttl_seconds?: number
  ttl?: number
}

/** Normalized credential request used by `RoostCredentialsService`. */
export interface NormalizedCredentialRequest {
  aud: string
  orgId: string | null
  sandboxId: string | null
  scope: string[]
  ttlSeconds: number
}

/** Response of `POST /internal/roost/v1/credentials`. */
export interface CredentialResponse {
  token: string
  /** ISO-8601 timestamp of the JWT `exp` claim. */
  expires_at: string
  jti: string
  aud: string
}

/**
 * Optional body of `POST /internal/roost/v1/credentials/{jti}/revoke`.
 *
 * The contract specifies no request body; when the original JWT is supplied the
 * revocation row lives exactly until its `exp` (remaining lifetime). Without it the
 * row is kept for the maximum possible credential lifetime, which is still bounded.
 */
export interface RevokeCredentialBody {
  token?: string
  exp?: number
  expires_at?: string
  reason?: string
}
