/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

export type MarketListingSort = 'newest' | 'price_asc' | 'price_desc' | 'capacity_desc'

export type MarketListingStatus = 'draft' | 'pending_approval' | 'published' | 'paused' | 'retired'

export interface MarketListing {
  id: string
  providerOrganizationId: string
  regionId: string
  regionName: string | null
  name: string
  description: string | null
  currency: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
  totalCpu: number
  totalMemoryGiB: number
  totalDiskGiB: number
  maxCpuPerSandbox: number
  maxMemoryPerSandbox: number
  maxDiskPerSandbox: number
  maxSandboxes: number
  visibility: 'public' | 'private'
  status: MarketListingStatus
  platformFeeBps: number
  activeLeaseCount?: number
  reputation?: MarketReputation | null
  slaAvailabilityPct: number
  slaCompensationBps: number
  createdAt: string
  updatedAt: string
}

export interface MarketListingsResponse {
  items: MarketListing[]
}

export interface MarketLease {
  id: string
  listingId: string
  listingName: string | null
  providerOrganizationId: string
  regionId: string
  regionName: string | null
  consumerOrganizationId: string
  status: 'active' | 'closed'
  currency: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
  totalCpu: number
  totalMemoryGiB: number
  totalDiskGiB: number
  maxCpuPerSandbox: number
  maxMemoryPerSandbox: number
  maxDiskPerSandbox: number
  createdAt: string
  closedAt: string | null
}

export interface MarketLeasesResponse {
  items: MarketLease[]
}

export interface OpenMarketLeasePayload {
  listingId: string
  totalCpu?: number
  totalMemoryGiB?: number
  totalDiskGiB?: number
}

export interface MarketUsageQuery {
  from?: string
  to?: string
}

export interface MarketUsageItem {
  date: string | null
  listingId: string
  listingName: string | null
  regionId: string
  regionName: string | null
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  amountCents: number
  currency: string
}

export interface MarketUsageResponse {
  from: string
  to: string
  currency: string
  items: MarketUsageItem[]
  totals: {
    cpuHours: number
    memoryGiBHours: number
    diskGiBHours: number
    gpuHours: number
    amountCents: number
  }
}

export interface PublishMarketListingPayload {
  regionId: string
  name: string
  description?: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents?: number
  totalCpu: number
  totalMemoryGiB: number
  totalDiskGiB: number
  maxCpuPerSandbox?: number
  maxMemoryPerSandbox?: number
  maxDiskPerSandbox?: number
  maxSandboxes?: number
  status?: 'published' | 'paused'
}

export interface UpdateMarketListingPayload {
  name?: string
  description?: string
  cpuHourCents?: number
  memoryGiBHourCents?: number
  diskGiBHourCents?: number
  gpuHourCents?: number
  totalCpu?: number
  totalMemoryGiB?: number
  totalDiskGiB?: number
  maxCpuPerSandbox?: number
  maxMemoryPerSandbox?: number
  maxDiskPerSandbox?: number
  maxSandboxes?: number
  status?: MarketListingStatus
}

export type MarketCreditEntryType = 'topup' | 'charge' | 'refund' | 'adjustment'

export interface MarketCreditEntry {
  id: string
  type: MarketCreditEntryType
  amountCents: number
  balanceAfterCents: number
  currency: string
  description: string | null
  referenceType: string | null
  referenceId: string | null
  createdAt: string
}

export interface MarketCreditResponse {
  balanceCents: number
  currency: string
  entries: MarketCreditEntry[]
}

export interface MarketUsageCharge {
  id: string
  leaseId: string
  listingId: string
  listingName: string | null
  periodStart: string
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  amountCents: number
  platformFeeCents: number
  providerNetCents: number
  currency: string
  createdAt: string
}

export interface MarketChargesResponse {
  items: MarketUsageCharge[]
}

export interface MarketChargesQuery {
  from?: string
  to?: string
}

export interface MarketSettings {
  platformFeeBps: number
}

export interface MarketOverview {
  listings: Record<string, number>
  activeLeases: number
  charges: { count: number; amountCents: number; platformFeeCents: number }
  negativeBalanceOrganizations: Array<{ organizationId: string; balanceCents: number }>
  platformFeeBps: number
}

export type MarketBidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'

export interface MarketBid {
  id: string
  listingId: string
  listingName: string | null
  regionId: string | null
  providerOrganizationId: string | null
  consumerOrganizationId: string
  status: MarketBidStatus
  currency: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
  totalCpu: number
  totalMemoryGiB: number
  totalDiskGiB: number
  message: string | null
  leaseId: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface MarketBidsResponse {
  items: MarketBid[]
}

export interface CreateMarketBidPayload {
  listingId: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents?: number
  totalCpu: number
  totalMemoryGiB: number
  totalDiskGiB: number
  message?: string
}

export interface MarketSlaEvent {
  id: string
  leaseId: string
  periodStart: string
  availabilityPct: number
  requiredAvailabilityPct: number
  compensationCents: number
  currency: string
  reason: string
  createdAt: string
}

export interface MarketSlaEventsResponse {
  items: MarketSlaEvent[]
}

export type MarketAlertType = 'low_balance' | 'negative_balance' | 'sla_breach'

export interface MarketAlert {
  id: string
  type: MarketAlertType
  severity: 'warning' | 'critical'
  message: string
  createdAt: string
  resolvedAt: string | null
}

export interface MarketAlertsResponse {
  items: MarketAlert[]
}

export interface MarketReputation {
  availabilityScore: number
  startupSuccessRatePct: number | null
  avgStartupSeconds: number | null
  sandboxStarts7d: number
  sandboxStartFailures7d: number
  openAlertCount: number
}
