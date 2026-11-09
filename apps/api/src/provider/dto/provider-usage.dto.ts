/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator'

export type ProviderUsageGranularity = 'day' | 'total'

@ApiSchema({ name: 'ProviderUsageQuery' })
export class ProviderUsageQueryDto {
  @ApiPropertyOptional({
    description: 'Start date (inclusive), ISO 8601 date, e.g. 2026-11-01. Defaults to 7 days ago.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({
    description: 'End date (inclusive), ISO 8601 date, e.g. 2026-11-09. Defaults to today.',
    example: '2026-11-09',
  })
  @IsOptional()
  @IsDateString()
  to?: string

  @ApiPropertyOptional({
    description: 'Aggregation granularity. "day" groups by day and node, "total" groups by node only.',
    enum: ['day', 'total'],
    example: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'total'])
  granularity?: ProviderUsageGranularity

  @ApiPropertyOptional({
    description: 'Only include usage from the given node (runner ID)',
    example: 'd4e5f6a7-1234-5678-90ab-cdef01234567',
  })
  @IsOptional()
  @IsString()
  runnerId?: string
}

@ApiSchema({ name: 'ProviderUsageItem' })
export class ProviderUsageItemDto {
  @ApiPropertyOptional({
    description: 'UTC day the usage belongs to. Null when granularity is "total".',
    example: '2026-11-09',
    nullable: true,
  })
  date: string | null

  @ApiPropertyOptional({
    description: 'Runner (compute node) the usage is attributed to',
    example: 'd4e5f6a7-1234-5678-90ab-cdef01234567',
    nullable: true,
  })
  runnerId: string | null

  @ApiProperty({ description: 'Display name of the runner', example: 'my-laptop' })
  runnerName: string

  @ApiProperty({ description: 'Billable CPU hours (vCPU · h)', example: 12.5 })
  cpuHours: number

  @ApiProperty({ description: 'Billable memory (GiB · h)', example: 100.25 })
  memoryGiBHours: number

  @ApiProperty({ description: 'Billable disk (GiB · h)', example: 250.5 })
  diskGiBHours: number

  @ApiProperty({ description: 'Billable GPU hours', example: 0 })
  gpuHours: number

  @ApiProperty({ description: 'Number of distinct sandboxes served', example: 3 })
  sandboxCount: number
}

@ApiSchema({ name: 'ProviderUsageTotals' })
export class ProviderUsageTotalsDto {
  @ApiProperty({ description: 'Total billable CPU hours (vCPU · h)', example: 12.5 })
  cpuHours: number

  @ApiProperty({ description: 'Total billable memory (GiB · h)', example: 100.25 })
  memoryGiBHours: number

  @ApiProperty({ description: 'Total billable disk (GiB · h)', example: 250.5 })
  diskGiBHours: number

  @ApiProperty({ description: 'Total billable GPU hours', example: 0 })
  gpuHours: number

  @ApiProperty({ description: 'Number of distinct sandboxes served', example: 3 })
  sandboxCount: number
}

@ApiSchema({ name: 'ProviderUsageResponse' })
export class ProviderUsageResponseDto {
  @ApiProperty({ description: 'Start date of the aggregation window (inclusive)', example: '2026-11-01' })
  from: string

  @ApiProperty({ description: 'End date of the aggregation window (inclusive)', example: '2026-11-09' })
  to: string

  @ApiProperty({ description: 'Currency used for revenue calculations', example: 'CNY' })
  currency: string

  @ApiProperty({ description: 'Usage entries, sorted by date descending', type: [ProviderUsageItemDto] })
  items: ProviderUsageItemDto[]

  @ApiProperty({ description: 'Totals across all entries', type: ProviderUsageTotalsDto })
  totals: ProviderUsageTotalsDto
}
