/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

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
