/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { RunnerAlertSeverity, RunnerAlertType } from '../entities/runner-alert.entity'

export type ProviderAlertState = 'open' | 'resolved' | 'all'

@ApiSchema({ name: 'ProviderAlertsQuery' })
export class ProviderAlertsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by alert state. Defaults to "open".',
    enum: ['open', 'resolved', 'all'],
    example: 'open',
  })
  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  state?: ProviderAlertState

  @ApiPropertyOptional({
    description: 'Only include alerts for the given node',
    example: 'd4e5f6a7-1234-5678-90ab-cdef01234567',
  })
  @IsOptional()
  @IsString()
  runnerId?: string

  @ApiPropertyOptional({
    description: 'Maximum number of alerts to return',
    example: 50,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number
}

@ApiSchema({ name: 'ProviderAlertItem' })
export class ProviderAlertItemDto {
  @ApiProperty({ description: 'Alert ID', example: '5f1b7a2c-1234-5678-90ab-cdef01234567' })
  id: string

  @ApiProperty({ description: 'Runner (compute node) ID', example: 'd4e5f6a7-1234-5678-90ab-cdef01234567' })
  runnerId: string

  @ApiProperty({ description: 'Display name of the runner', example: 'my-laptop' })
  runnerName: string

  @ApiProperty({
    description: 'Alert type',
    enum: RunnerAlertType,
    example: RunnerAlertType.OFFLINE,
  })
  type: RunnerAlertType

  @ApiProperty({
    description: 'Alert severity',
    enum: RunnerAlertSeverity,
    example: RunnerAlertSeverity.CRITICAL,
  })
  severity: RunnerAlertSeverity

  @ApiProperty({ description: 'Human readable alert message', example: 'Node has not reported a heartbeat for 95s' })
  message: string

  @ApiPropertyOptional({
    description: 'Additional alert details',
    nullable: true,
  })
  details: Record<string, unknown> | null

  @ApiProperty({ description: 'Creation timestamp', example: '2026-11-09T12:00:00.000Z' })
  createdAt: string

  @ApiPropertyOptional({
    description: 'Resolution timestamp, null while the alert is open',
    example: null,
    nullable: true,
  })
  resolvedAt: string | null
}

@ApiSchema({ name: 'ProviderAlertsResponse' })
export class ProviderAlertsResponseDto {
  @ApiProperty({ description: 'Alerts for the compute nodes of the organization', type: [ProviderAlertItemDto] })
  items: ProviderAlertItemDto[]
}
