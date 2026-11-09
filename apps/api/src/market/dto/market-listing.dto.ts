/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { MarketListingStatus, MarketListingVisibility } from '../enums/market-listing-status.enum'
import { MarketListing } from '../entities/market-listing.entity'

@ApiSchema({ name: 'CreateMarketListing' })
export class CreateMarketListingDto {
  @ApiProperty({
    description: 'Region (owned by the provider organization) that backs this listing',
    example: 'us-nyc-1',
  })
  @IsString()
  regionId: string

  @ApiProperty({ description: 'Human readable listing name', example: 'NYC RTX 4090 pool' })
  @IsString()
  @MaxLength(255)
  name: string

  @ApiPropertyOptional({ description: 'Free-form description' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: 'Billing currency (ISO 4217)', example: 'CNY', default: 'CNY' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string

  @ApiProperty({ description: 'Price per vCPU hour in integer cents', example: 100, minimum: 0 })
  @IsInt()
  @Min(0)
  cpuHourCents: number

  @ApiProperty({ description: 'Price per GiB memory hour in integer cents', example: 10, minimum: 0 })
  @IsInt()
  @Min(0)
  memoryGiBHourCents: number

  @ApiProperty({ description: 'Price per GiB disk hour in integer cents', example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  diskGiBHourCents: number

  @ApiPropertyOptional({ description: 'Price per GPU hour in integer cents', example: 0, minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  gpuHourCents?: number

  @ApiProperty({ description: 'Total vCPU available to a single lease', example: 8, minimum: 1 })
  @IsInt()
  @Min(1)
  totalCpu: number

  @ApiProperty({ description: 'Total memory (GiB) available to a single lease', example: 16, minimum: 1 })
  @IsInt()
  @Min(1)
  totalMemoryGiB: number

  @ApiProperty({ description: 'Total disk (GiB) available to a single lease', example: 50, minimum: 1 })
  @IsInt()
  @Min(1)
  totalDiskGiB: number

  @ApiPropertyOptional({ description: 'Max vCPU per sandbox', example: 4, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCpuPerSandbox?: number

  @ApiPropertyOptional({ description: 'Max memory (GiB) per sandbox', example: 8, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxMemoryPerSandbox?: number

  @ApiPropertyOptional({ description: 'Max disk (GiB) per sandbox', example: 20, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiskPerSandbox?: number

  @ApiPropertyOptional({ description: 'Max concurrent sandboxes per lease', example: 10, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxSandboxes?: number

  @ApiPropertyOptional({
    description:
      'Listing status after publish. Defaults to published (or pending_approval when the platform requires approval).',
    enum: [MarketListingStatus.PUBLISHED, MarketListingStatus.PAUSED],
  })
  @IsOptional()
  @IsEnum(MarketListingStatus)
  status?: MarketListingStatus.PUBLISHED | MarketListingStatus.PAUSED
}

@ApiSchema({ name: 'UpdateMarketListing' })
export class UpdateMarketListingDto {
  @ApiPropertyOptional({ description: 'Human readable listing name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string

  @ApiPropertyOptional({ description: 'Free-form description' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: 'Price per vCPU hour in integer cents', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  cpuHourCents?: number

  @ApiPropertyOptional({ description: 'Price per GiB memory hour in integer cents', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  memoryGiBHourCents?: number

  @ApiPropertyOptional({ description: 'Price per GiB disk hour in integer cents', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  diskGiBHourCents?: number

  @ApiPropertyOptional({ description: 'Price per GPU hour in integer cents', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  gpuHourCents?: number

  @ApiPropertyOptional({ description: 'Total vCPU available to a single lease', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalCpu?: number

  @ApiPropertyOptional({ description: 'Total memory (GiB) available to a single lease', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalMemoryGiB?: number

  @ApiPropertyOptional({ description: 'Total disk (GiB) available to a single lease', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalDiskGiB?: number

  @ApiPropertyOptional({ description: 'Max vCPU per sandbox', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCpuPerSandbox?: number

  @ApiPropertyOptional({ description: 'Max memory (GiB) per sandbox', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxMemoryPerSandbox?: number

  @ApiPropertyOptional({ description: 'Max disk (GiB) per sandbox', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiskPerSandbox?: number

  @ApiPropertyOptional({ description: 'Max concurrent sandboxes per lease', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxSandboxes?: number

  @ApiPropertyOptional({ description: 'Listing status', enum: MarketListingStatus })
  @IsOptional()
  @IsEnum(MarketListingStatus)
  status?: MarketListingStatus
}

export const MARKET_LISTING_SORTS = ['newest', 'price_asc', 'price_desc', 'capacity_desc'] as const
export type MarketListingSort = (typeof MARKET_LISTING_SORTS)[number]

@ApiSchema({ name: 'MarketListingsQuery' })
export class MarketListingsQueryDto {
  @ApiPropertyOptional({
    description: 'Ordering of the public listings',
    enum: MARKET_LISTING_SORTS,
    default: 'newest',
  })
  @IsOptional()
  @IsIn(MARKET_LISTING_SORTS)
  sort?: MarketListingSort
}

@ApiSchema({ name: 'MarketListing' })
export class MarketListingDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  providerOrganizationId: string

  @ApiProperty()
  regionId: string

  @ApiPropertyOptional({ nullable: true })
  regionName: string | null

  @ApiProperty()
  name: string

  @ApiPropertyOptional({ nullable: true })
  description: string | null

  @ApiProperty()
  currency: string

  @ApiProperty()
  cpuHourCents: number

  @ApiProperty()
  memoryGiBHourCents: number

  @ApiProperty()
  diskGiBHourCents: number

  @ApiProperty()
  gpuHourCents: number

  @ApiProperty()
  totalCpu: number

  @ApiProperty()
  totalMemoryGiB: number

  @ApiProperty()
  totalDiskGiB: number

  @ApiProperty()
  maxCpuPerSandbox: number

  @ApiProperty()
  maxMemoryPerSandbox: number

  @ApiProperty()
  maxDiskPerSandbox: number

  @ApiProperty()
  maxSandboxes: number

  @ApiProperty({ enum: MarketListingVisibility })
  visibility: MarketListingVisibility

  @ApiProperty({ enum: MarketListingStatus })
  status: MarketListingStatus

  @ApiProperty()
  platformFeeBps: number

  @ApiPropertyOptional({ description: 'Number of active leases on this listing', example: 1 })
  activeLeaseCount?: number

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date

  static fromEntity(
    listing: MarketListing,
    extra?: { regionName?: string | null; activeLeaseCount?: number },
  ): MarketListingDto {
    return {
      id: listing.id,
      providerOrganizationId: listing.providerOrganizationId,
      regionId: listing.regionId,
      regionName: extra?.regionName ?? null,
      name: listing.name,
      description: listing.description ?? null,
      currency: listing.currency,
      cpuHourCents: listing.cpuHourCents,
      memoryGiBHourCents: listing.memoryGiBHourCents,
      diskGiBHourCents: listing.diskGiBHourCents,
      gpuHourCents: listing.gpuHourCents,
      totalCpu: listing.totalCpu,
      totalMemoryGiB: listing.totalMemoryGiB,
      totalDiskGiB: listing.totalDiskGiB,
      maxCpuPerSandbox: listing.maxCpuPerSandbox,
      maxMemoryPerSandbox: listing.maxMemoryPerSandbox,
      maxDiskPerSandbox: listing.maxDiskPerSandbox,
      maxSandboxes: listing.maxSandboxes,
      visibility: listing.visibility,
      status: listing.status,
      platformFeeBps: listing.platformFeeBps,
      activeLeaseCount: extra?.activeLeaseCount,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    }
  }
}

@ApiSchema({ name: 'MarketListingsResponse' })
export class MarketListingsResponseDto {
  @ApiProperty({ type: [MarketListingDto] })
  items: MarketListingDto[]
}
