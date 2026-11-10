/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/**
 * Claims carried by a short-lived Roost credential.
 *
 * The claim names are frozen by the `api/internal-daytona.yaml` contract in the
 * market service repository and must not be renamed.
 */
export interface RoostJwtClaims {
  iss: string
  aud: string
  sub: string
  org_id: string | null
  sandbox_id: string | null
  scope: string[]
  iat: number
  exp: number
  jti: string
}
