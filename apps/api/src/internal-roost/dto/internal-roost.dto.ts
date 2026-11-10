/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/** Body of `POST /internal/roost/v1/tenants`. Contract uses snake_case. */
export interface ProvisionTenantBody {
  external_id?: string
  externalId?: string
  name?: string
  owner_email?: string
  ownerEmail?: string
}

/** Response of `POST /internal/roost/v1/tenants`. */
export interface ProvisionTenantResponse {
  organization_id: string
  state: string
}

/** Body of `POST /internal/roost/v1/orgs/{orgId}/regions`. */
export interface CreateRegionBody {
  name?: string
  node_external_id?: string
  nodeExternalId?: string
}

/** Response of `POST /internal/roost/v1/orgs/{orgId}/regions`. */
export interface CreateRegionResponse {
  region_id: string
}

/** Body of `POST /internal/roost/v1/regions/{regionId}/runners`. */
export interface CreateRunnerBody {
  name?: string
  tags?: string[]
}

/** Response of `POST /internal/roost/v1/regions/{regionId}/runners`. */
export interface CreateRunnerResponse {
  runner_id: string
  /** Only ever returned from the creation response, never readable afterwards. */
  api_key: string
}

/**
 * Response of `GET /internal/roost/v1/runners/{runnerId}` (added for the market
 * node-heartbeat worker). Shape mirrors the market service `api/internal-daytona.yaml`
 * contract: snake_case, `state` is the Daytona RunnerState string.
 */
export interface RunnerHeartbeatResponse {
  runner_id: string
  state: string
  last_seen_at: string | null
  sandbox_count: number | null
}

/** Body of `PUT /internal/roost/v1/orgs/{orgId}/regions/{regionId}/quota`. */
export interface PutRegionQuotaBody {
  source?: string
  sandbox_class?: string
  sandboxClass?: string
  limits?: {
    cpu?: number
    memory_gib?: number
    memoryGiB?: number
    disk_gib?: number
    diskGiB?: number
    max_cpu_per_sandbox?: number
    maxCpuPerSandbox?: number
    max_memory_per_sandbox?: number
    maxMemoryPerSandbox?: number
    max_disk_per_sandbox?: number
    maxDiskPerSandbox?: number
  }
}

/** Body of `POST /internal/roost/v1/orgs/{orgId}/sandbox`. */
export interface CreateSandboxBody {
  name?: string
  snapshot?: string
  sandbox_class?: string
  sandboxClass?: string
  cpu?: number
  memory_gib?: number
  memoryGiB?: number
  disk_gib?: number
  diskGiB?: number
  gpu?: number
  env?: Record<string, string>
  auto_stop_minutes?: number
  autoStopMinutes?: number
  user?: string
  public?: boolean
  /**
   * Fork extension: region/target the sandbox must be scheduled in. The frozen
   * contract omitted it, but the market service needs to pin a lease sandbox to the
   * provider node's region. Accepts `region_id`, `regionId` or `target`.
   */
  region_id?: string
  regionId?: string
  target?: string
}

/** Response of sandbox control endpoints. */
export interface SandboxControlResponse {
  id: string
  state: string
  organization_id: string
}

/** One usage sample of `GET /internal/roost/v1/orgs/{orgId}/usage`. */
export interface UsageSample {
  sandbox_id?: string
  period_start: string
  period_end: string
  cpu_seconds: number
  memory_mib_seconds: number
  disk_mib_seconds: number
  gpu_seconds: number
}

export interface UsagePage {
  items: UsageSample[]
}
