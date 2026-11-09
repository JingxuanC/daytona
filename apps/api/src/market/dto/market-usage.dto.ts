/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsOptional } from 'class-validator'

@ApiSchema({ name: 'MarketUsageQuery' })
export class MarketUsageQueryDto {
  @ApiPropertyOptional({ description: 'Start date (inclusive), ISO 8601 date. Defaults to 7 days ago.' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ description: 'End date (inclusive), ISO 8601 date. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  to?: string
}

@ApiSchema({ name: 'MarketUsageItem' })
export class MarketUsageItemDto {
  @ApiPropertyOptional({ description: 'UTC day the usage belongs to', nullable: true })
  date: string | null

  @ApiProperty()
  listingId: string

  @ApiPropertyOptional({ nullable: true })
  listingName: string | null

  @ApiProperty()
  regionId: string

  @ApiPropertyOptional({ nullable: true })
  regionName: string | null

  @ApiProperty()
  cpuHours: number

  @ApiProperty()
  memoryGiBHours: number

  @ApiProperty()
  diskGiBHours: number

  @ApiProperty()
  gpuHours: number

  @ApiProperty({ description: 'Amount owed for this bucket, in integer cents', example: 12 })
  amountCents: number

  @ApiProperty()
  currency: string
}

@ApiSchema({ name: 'MarketUsageResponse' })
export class MarketUsageResponseDto {
  @ApiProperty()
  from: string

  @ApiProperty()
  to: string

  @ApiProperty()
  currency: string

  @ApiProperty({ type: [MarketUsageItemDto] })
  items: MarketUsageItemDto[]

  @ApiProperty({ type: MarketUsageItemDto, description: 'Aggregated totals across all items' })
  totals: {
    cpuHours: number
    memoryGiBHours: number
    diskGiBHours: number
    gpuHours: number
    amountCents: number
  }
}
