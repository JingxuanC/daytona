/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/**
 * Bodies of the optional M1 sandbox operation endpoints.
 *
 * The fork currently supports these operations through `SandboxService`:
 * - pause: no request body
 * - resize: `cpu` / `memory` / `disk` (the exact fields of `ResizeSandboxDto`)
 * - snapshot: `name` / `includeMemory` (`CreateSandboxSnapshotDto`), with
 *   `include_memory` accepted as a snake_case alias for internal callers
 *
 * Any other field is rejected with `400 invalid_request` that names both the
 * unsupported and the supported fields (never silently ignored).
 */

export interface PauseSandboxBody {
  [field: string]: unknown
}

export interface ResizeSandboxBody {
  cpu?: number
  memory?: number
  disk?: number
  [field: string]: unknown
}

export interface SnapshotSandboxBody {
  name?: string
  includeMemory?: boolean
  include_memory?: boolean
  [field: string]: unknown
}

/** Response of the optional sandbox operation endpoints. */
export interface SandboxOperationResponse {
  id: string
  state: string
  organization_id: string
}

/** Snapshot creation is asynchronous; the response echoes the requested name. */
export interface SnapshotSandboxResponse extends SandboxOperationResponse {
  snapshot_name: string
}
