/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator'
import { MarketBid, MarketBidStatus } from '../entities/market-bid.entity'

@ApiSchema({ name: 'CreateMarketBid' })
export class CreateMarketBidDto {
  @ApiProperty({ description: 'Listing to bid on' })
  @IsUUID()
  listingId: string

  @ApiProperty({ description: 'Bid price per vCPU hour in integer cents', example: 80, minimum: 0 })
  @IsInt()
  @Min(0)
  cpuHourCents: number

  @ApiProperty({ description: 'Bid price per GiB memory hour in integer cents', example: 8, minimum: 0 })
  @IsInt()
  @Min(0)
  memoryGiBHourCents: number

  @ApiProperty({ description: 'Bid price per GiB disk hour in integer cents', example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  diskGiBHourCents: number

  @ApiPropertyOptional({ description: 'Bid price per GPU hour in integer cents', example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  gpuHourCents?: number

  @ApiProperty({ description: 'Requested vCPU', example: 4, minimum: 1 })
  @IsInt()
  @Min(1)
  totalCpu: number

  @ApiProperty({ description: 'Requested memory (GiB)', example: 8, minimum: 1 })
  @IsInt()
  @Min(1)
  totalMemoryGiB: number

  @ApiProperty({ description: 'Requested disk (GiB)', example: 20, minimum: 1 })
  @IsInt()
  @Min(1)
  totalDiskGiB: number

  @ApiPropertyOptional({ description: 'Message to the provider' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string
}

@ApiSchema({ name: 'MarketBid' })
export class MarketBidDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  listingId: string

  @ApiPropertyOptional({ nullable: true })
  listingName: string | null

  @ApiPropertyOptional({ nullable: true })
  regionId: string | null

  @ApiPropertyOptional({ nullable: true })
  providerOrganizationId: string | null

  @ApiProperty()
  consumerOrganizationId: string

  @ApiProperty({ enum: MarketBidStatus })
  status: MarketBidStatus

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

  @ApiPropertyOptional({ nullable: true })
  message: string | null

  @ApiPropertyOptional({ nullable: true })
  leaseId: string | null

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt: Date | null

  static fromEntity(
    bid: MarketBid,
    listing?: { name: string; regionId: string; providerOrganizationId: string },
  ): MarketBidDto {
    return {
      id: bid.id,
      listingId: bid.listingId,
      listingName: listing?.name ?? null,
      regionId: listing?.regionId ?? null,
      providerOrganizationId: listing?.providerOrganizationId ?? null,
      consumerOrganizationId: bid.consumerOrganizationId,
      status: bid.status,
      currency: bid.currency,
      cpuHourCents: bid.cpuHourCents,
      memoryGiBHourCents: bid.memoryGiBHourCents,
      diskGiBHourCents: bid.diskGiBHourCents,
      gpuHourCents: bid.gpuHourCents,
      totalCpu: bid.totalCpu,
      totalMemoryGiB: bid.totalMemoryGiB,
      totalDiskGiB: bid.totalDiskGiB,
      message: bid.message ?? null,
      leaseId: bid.leaseId ?? null,
      createdAt: bid.createdAt,
      resolvedAt: bid.resolvedAt ?? null,
    }
  }
}

@ApiSchema({ name: 'MarketBidsResponse' })
export class MarketBidsResponseDto {
  @ApiProperty({ type: [MarketBidDto] })
  items: MarketBidDto[]
}
