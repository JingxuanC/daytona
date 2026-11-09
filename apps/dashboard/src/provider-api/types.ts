/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/**
 * 算力提供方控制台（Provider Console）API 契约类型。
 *
 * 契约来源：provider-console-plan.md。金额字段一律为整数分（cents），
 * 时间字段为 ISO 8601 字符串；后端新增状态时前端按原始字符串降级展示。
 */

/** 节点运行状态，与 RunnerState 对齐（ready / unresponsive / initializing / disabled / decommissioned） */
export type ProviderNodeState = string

/** 节点视图（GET /provider/nodes） */
export interface ProviderNode {
  runnerId: string
  name: string
  regionId: string
  regionName: string
  state: ProviderNodeState
  unschedulable: boolean
  lastCheckedAt: string | null
  rttMs: number | null
  totalCpu: number
  totalMemoryGiB: number
  totalDiskGiB: number
  cpuUsagePct: number
  memoryUsagePct: number
  diskUsagePct: number
  allocatedCpu: number
  allocatedMemoryGiB: number
  allocatedDiskGiB: number
  startedSandboxes: number
  availabilityScore: number
  appVersion: string | null
  sandboxStarts7d: number
  sandboxStartFailures7d: number
  avgStartupSeconds7d: number | null
  openAlertCount: number
}

export interface ProviderNodesResponse {
  items: ProviderNode[]
}

/** 节点上的沙箱（GET /provider/nodes/:runnerId/sandboxes） */
export interface ProviderNodeSandbox {
  sandboxId: string
  name: string
  state: string
  cpu: number
  memoryGiB: number
  diskGiB: number
  createdAt: string
  startedAt: string | null
}

export interface ProviderNodeSandboxesResponse {
  items: ProviderNodeSandbox[]
}

export type ProviderUsageGranularity = 'day' | 'total'

export interface ProviderUsageQuery {
  /** YYYY-MM-DD */
  from: string
  /** YYYY-MM-DD */
  to: string
  granularity?: ProviderUsageGranularity
  runnerId?: string
}

/** 用量聚合行（GET /provider/usage） */
export interface ProviderUsageItem {
  /** granularity=total 时为 null */
  date: string | null
  /** granularity=total 时为 null */
  runnerId: string | null
  runnerName: string
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  sandboxCount: number
}

export interface ProviderUsageTotals {
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  sandboxCount: number
}

export interface ProviderUsageResponse {
  from: string
  to: string
  currency: string
  items: ProviderUsageItem[]
  totals: ProviderUsageTotals
}

/** 节点定价（GET /provider/pricing） */
export interface ProviderPricingItem {
  runnerId: string
  runnerName: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
  updatedAt: string | null
}

export interface ProviderPricingResponse {
  currency: string
  items: ProviderPricingItem[]
}

/** 更新定价（PUT /provider/pricing/:runnerId），数值为不小于 0 的整数分 */
export interface UpdateProviderPricingPayload {
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
}

export interface ProviderEarningsQuery {
  /** YYYY-MM-DD */
  from: string
  /** YYYY-MM-DD */
  to: string
  runnerId?: string
}

/** 收益行（GET /provider/earnings，按节点 × 天） */
export interface ProviderEarningsItem {
  date: string
  /** 未归属到具体节点的用量为 null */
  runnerId: string | null
  runnerName: string
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  amountCents: number
  /** 当天已结算时返回结算状态 */
  settlementStatus?: ProviderSettlementStatus | null
  /** 当天已结算时返回结算单 ID */
  settlementId?: string | null
}

export interface ProviderEarningsTotals {
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  amountCents: number
}

export interface ProviderEarningsResponse {
  from: string
  to: string
  currency: string
  items: ProviderEarningsItem[]
  totals: ProviderEarningsTotals
}

export type ProviderSettlementStatus = 'PENDING' | 'SETTLED' | 'WITHDRAWING' | 'WITHDRAWN'

/** 结算单（GET /provider/settlements） */
export interface ProviderSettlement {
  id: string
  runnerId: string
  runnerName: string
  /** YYYY-MM-DD */
  periodStart: string
  /** YYYY-MM-DD */
  periodEnd: string
  status: ProviderSettlementStatus
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  amountCents: number
  platformFeeCents: number
  netCents: number
  currency: string
  settledAt: string | null
  /** 实际提现时间 */
  withdrawnAt?: string | null
  createdAt: string
}

export interface ProviderSettlementsResponse {
  items: ProviderSettlement[]
}

export interface ProviderSettlementQuery {
  status?: ProviderSettlementStatus
  /** YYYY-MM-DD */
  from?: string
  /** YYYY-MM-DD */
  to?: string
  runnerId?: string
}

/** 结算单按沙箱拆分（GET /provider/settlements/:id 的 lines） */
export interface ProviderSettlementLine {
  sandboxId: string
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  amountCents: number
}

export interface ProviderSettlementDetail extends ProviderSettlement {
  lines: ProviderSettlementLine[]
}

export type ProviderAlertType = 'OFFLINE' | 'HEALTHCHECK_FAILED' | 'HIGH_LATENCY' | 'RESOURCE_PRESSURE'

export type ProviderAlertSeverity = 'WARNING' | 'CRITICAL'

export type ProviderAlertState = 'open' | 'resolved' | 'all'

/** 节点告警（GET /provider/alerts） */
export interface ProviderAlert {
  id: string
  runnerId: string
  runnerName: string
  type: ProviderAlertType
  severity: ProviderAlertSeverity
  message: string
  createdAt: string
  resolvedAt: string | null
}

export interface ProviderAlertsResponse {
  items: ProviderAlert[]
}

export interface ProviderAlertsQuery {
  state?: ProviderAlertState
  limit?: number
}
