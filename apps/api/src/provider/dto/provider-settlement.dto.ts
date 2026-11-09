/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { SettlementStatus } from '../entities/settlement-period.entity'

const SETTLEMENT_STATUSES = Object.values(SettlementStatus)

@ApiSchema({ name: 'ProviderSettlementsQuery' })
export class ProviderSettlementsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by settlement status',
    enum: SettlementStatus,
    example: SettlementStatus.PENDING,
  })
  @IsOptional()
  @IsIn(SETTLEMENT_STATUSES)
  status?: SettlementStatus

  @ApiPropertyOptional({
    description: 'Start date (inclusive), ISO 8601 date',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({
    description: 'End date (inclusive), ISO 8601 date',
    example: '2026-11-09',
  })
  @IsOptional()
  @IsDateString()
  to?: string

  @ApiPropertyOptional({
    description: 'Only include settlements for the given node',
    example: 'd4e5f6a7-1234-5678-90ab-cdef01234567',
  })
  @IsOptional()
  @IsString()
  runnerId?: string

  @ApiPropertyOptional({
    description: 'Maximum number of settlements to return',
    example: 200,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number
}

@ApiSchema({ name: 'UpdateProviderSettlementStatus' })
export class UpdateProviderSettlementStatusDto {
  @ApiProperty({
    description:
      'Target status. Only SETTLED -> WITHDRAWING and WITHDRAWING -> WITHDRAWN transitions are allowed for providers; PENDING -> SETTLED is performed by the platform.',
    enum: [SettlementStatus.WITHDRAWING, SettlementStatus.WITHDRAWN],
    example: SettlementStatus.WITHDRAWING,
  })
  @IsIn([SettlementStatus.WITHDRAWING, SettlementStatus.WITHDRAWN])
  status: SettlementStatus.WITHDRAWING | SettlementStatus.WITHDRAWN
}

@ApiSchema({ name: 'ProviderSettlementItem' })
export class ProviderSettlementItemDto {
  @ApiProperty({ description: 'Settlement ID', example: '5f1b7a2c-1234-5678-90ab-cdef01234567' })
  id: string

  @ApiProperty({ description: 'Runner (compute node) ID', example: 'd4e5f6a7-1234-5678-90ab-cdef01234567' })
  runnerId: string

  @ApiProperty({ description: 'Display name of the runner', example: 'my-laptop' })
  runnerName: string

  @ApiProperty({ description: 'Inclusive UTC day being settled, YYYY-MM-DD', example: '2026-11-08' })
  periodStart: string

  @ApiProperty({ description: 'Inclusive UTC day being settled, YYYY-MM-DD', example: '2026-11-08' })
  periodEnd: string

  @ApiProperty({
    description: 'Settlement status',
    enum: SettlementStatus,
    example: SettlementStatus.PENDING,
  })
  status: SettlementStatus

  @ApiProperty({ description: 'Billable CPU hours (vCPU · h)', example: 12.5 })
  cpuHours: number

  @ApiProperty({ description: 'Billable memory (GiB · h)', example: 100.25 })
  memoryGiBHours: number

  @ApiProperty({ description: 'Billable disk (GiB · h)', example: 250.5 })
  diskGiBHours: number

  @ApiProperty({ description: 'Billable GPU hours', example: 0 })
  gpuHours: number

  @ApiProperty({ description: 'Settled amount in integer cents', example: 1234 })
  amountCents: number

  @ApiProperty({ description: 'Platform commission in integer cents', example: 123 })
  platformFeeCents: number

  @ApiProperty({ description: 'Provider net revenue after commission, in integer cents', example: 1111 })
  netCents: number

  @ApiProperty({ description: 'Currency of the settled amount', example: 'CNY' })
  currency: string

  @ApiPropertyOptional({
    description: 'When the platform settled the amount',
    example: '2026-11-09T01:00:00.000Z',
    nullable: true,
  })
  settledAt: string | null

  @ApiPropertyOptional({
    description: 'When the amount was paid out',
    example: '2026-11-09T02:00:00.000Z',
    nullable: true,
  })
  withdrawnAt: string | null

  @ApiProperty({ description: 'Creation timestamp', example: '2026-11-09T01:00:00.000Z' })
  createdAt: string
}

@ApiSchema({ name: 'ProviderSettlementLine' })
export class ProviderSettlementLineDto {
  @ApiProperty({ description: 'Sandbox ID', example: 'sbx-1234' })
  sandboxId: string

  @ApiProperty({ description: 'Billable CPU hours (vCPU · h)', example: 1.5 })
  cpuHours: number

  @ApiProperty({ description: 'Billable memory (GiB · h)', example: 6 })
  memoryGiBHours: number

  @ApiProperty({ description: 'Billable disk (GiB · h)', example: 10 })
  diskGiBHours: number

  @ApiProperty({ description: 'Billable GPU hours', example: 0 })
  gpuHours: number

  @ApiProperty({ description: 'Amount earned from this sandbox in integer cents', example: 42 })
  amountCents: number
}

@ApiSchema({ name: 'ProviderSettlementsResponse' })
export class ProviderSettlementsResponseDto {
  @ApiProperty({ description: 'Settlement periods', type: [ProviderSettlementItemDto] })
  items: ProviderSettlementItemDto[]
}

@ApiSchema({ name: 'ProviderSettlementDetail' })
export class ProviderSettlementDetailDto extends ProviderSettlementItemDto {
  @ApiProperty({ description: 'Per-sandbox breakdown', type: [ProviderSettlementLineDto] })
  lines: ProviderSettlementLineDto[]
}
