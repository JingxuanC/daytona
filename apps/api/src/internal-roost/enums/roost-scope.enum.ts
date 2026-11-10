/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/**
 * Scopes a Roost credential can carry. Values are frozen by the
 * `api/internal-daytona.yaml` contract in the market service repository.
 */
export enum RoostScope {
  TENANT_PROVISION = 'tenant:provision',
  SANDBOX_CONTROL = 'sandbox:control',
  QUOTA_WRITE = 'quota:write',
  REGION_WRITE = 'region:write',
  RUNNER_WRITE = 'runner:write',
  USAGE_READ = 'usage:read',
  TOOLBOX = 'toolbox',
  PREVIEW = 'preview',
}

export const ROOST_SCOPES: string[] = Object.values(RoostScope)

/** Scopes accepted on data-plane (`aud=daytona-data`) credentials. */
export const ROOST_DATA_PLANE_SCOPES: string[] = [RoostScope.TOOLBOX, RoostScope.PREVIEW]

/** Scopes accepted on control-plane (`aud=daytona-control`) credentials. */
export const ROOST_CONTROL_PLANE_SCOPES: string[] = [
  RoostScope.TENANT_PROVISION,
  RoostScope.SANDBOX_CONTROL,
  RoostScope.QUOTA_WRITE,
  RoostScope.REGION_WRITE,
  RoostScope.RUNNER_WRITE,
  RoostScope.USAGE_READ,
]
