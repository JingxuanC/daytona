/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator'
import { SettlementStatus } from '../entities/settlement-period.entity'

@ApiSchema({ name: 'ProviderEarningsQuery' })
export class ProviderEarningsQueryDto {
  @ApiPropertyOptional({
    description: 'Start date (inclusive), ISO 8601 date. Defaults to 7 days ago.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({
    description: 'End date (inclusive), ISO 8601 date. Defaults to today.',
    example: '2026-11-09',
  })
  @IsOptional()
  @IsDateString()
  to?: string

  @ApiPropertyOptional({
    description: 'Only include earnings for the given node',
    example: 'd4e5f6a7-1234-5678-90ab-cdef01234567',
  })
  @IsOptional()
  @IsString()
  runnerId?: string
}

@ApiSchema({ name: 'ProviderEarningsItem' })
export class ProviderEarningsItemDto {
  @ApiProperty({ description: 'UTC day the earnings belong to', example: '2026-11-09' })
  date: string

  @ApiPropertyOptional({
    description: 'Runner (compute node) ID',
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

  @ApiProperty({ description: 'Earned amount in integer cents', example: 1234 })
  amountCents: number

  @ApiPropertyOptional({
    description: 'Settlement status when the day has already been settled',
    enum: SettlementStatus,
    nullable: true,
  })
  settlementStatus?: SettlementStatus | null

  @ApiPropertyOptional({
    description: 'Settlement ID when the day has already been settled',
    nullable: true,
  })
  settlementId?: string | null
}

@ApiSchema({ name: 'ProviderEarningsTotals' })
export class ProviderEarningsTotalsDto {
  @ApiProperty({ description: 'Total billable CPU hours (vCPU · h)', example: 12.5 })
  cpuHours: number

  @ApiProperty({ description: 'Total billable memory (GiB · h)', example: 100.25 })
  memoryGiBHours: number

  @ApiProperty({ description: 'Total billable disk (GiB · h)', example: 250.5 })
  diskGiBHours: number

  @ApiProperty({ description: 'Total billable GPU hours', example: 0 })
  gpuHours: number

  @ApiProperty({ description: 'Total earned amount in integer cents', example: 1234 })
  amountCents: number
}

@ApiSchema({ name: 'ProviderEarningsResponse' })
export class ProviderEarningsResponseDto {
  @ApiProperty({ description: 'Start date of the range (inclusive)', example: '2026-11-01' })
  from: string

  @ApiProperty({ description: 'End date of the range (inclusive)', example: '2026-11-09' })
  to: string

  @ApiProperty({ description: 'Currency of the amounts', example: 'CNY' })
  currency: string

  @ApiProperty({ description: 'Earnings entries, sorted by date descending', type: [ProviderEarningsItemDto] })
  items: ProviderEarningsItemDto[]

  @ApiProperty({ description: 'Totals across all entries', type: ProviderEarningsTotalsDto })
  totals: ProviderEarningsTotalsDto
}
