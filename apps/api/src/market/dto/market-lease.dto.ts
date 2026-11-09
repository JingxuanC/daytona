/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator'
import { MarketLeaseStatus } from '../enums/market-lease-status.enum'
import { MarketLease } from '../entities/market-lease.entity'
import { MarketListing } from '../entities/market-listing.entity'

@ApiSchema({ name: 'CreateMarketLease' })
export class CreateMarketLeaseDto {
  @ApiProperty({ description: 'Listing to rent capacity from' })
  @IsUUID()
  listingId: string

  @ApiPropertyOptional({ description: 'Leased vCPU capacity. Defaults to the listing total.', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalCpu?: number

  @ApiPropertyOptional({ description: 'Leased memory (GiB). Defaults to the listing total.', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalMemoryGiB?: number

  @ApiPropertyOptional({ description: 'Leased disk (GiB). Defaults to the listing total.', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalDiskGiB?: number
}

@ApiSchema({ name: 'MarketLease' })
export class MarketLeaseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  listingId: string

  @ApiPropertyOptional({ nullable: true })
  listingName: string | null

  @ApiProperty()
  providerOrganizationId: string

  @ApiProperty()
  regionId: string

  @ApiPropertyOptional({ nullable: true })
  regionName: string | null

  @ApiProperty()
  consumerOrganizationId: string

  @ApiProperty({ enum: MarketLeaseStatus })
  status: MarketLeaseStatus

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

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  closedAt: Date | null

  static fromEntity(lease: MarketLease, listing?: MarketListing | null, regionName?: string | null): MarketLeaseDto {
    return {
      id: lease.id,
      listingId: lease.listingId,
      listingName: listing?.name ?? null,
      providerOrganizationId: listing?.providerOrganizationId ?? '',
      regionId: listing?.regionId ?? '',
      regionName: regionName ?? null,
      consumerOrganizationId: lease.consumerOrganizationId,
      status: lease.status,
      currency: lease.currency,
      cpuHourCents: lease.cpuHourCents,
      memoryGiBHourCents: lease.memoryGiBHourCents,
      diskGiBHourCents: lease.diskGiBHourCents,
      gpuHourCents: lease.gpuHourCents,
      totalCpu: lease.totalCpu,
      totalMemoryGiB: lease.totalMemoryGiB,
      totalDiskGiB: lease.totalDiskGiB,
      maxCpuPerSandbox: lease.maxCpuPerSandbox,
      maxMemoryPerSandbox: lease.maxMemoryPerSandbox,
      maxDiskPerSandbox: lease.maxDiskPerSandbox,
      createdAt: lease.createdAt,
      closedAt: lease.closedAt,
    }
  }
}

@ApiSchema({ name: 'MarketLeasesResponse' })
export class MarketLeasesResponseDto {
  @ApiProperty({ type: [MarketLeaseDto] })
  items: MarketLeaseDto[]
}
