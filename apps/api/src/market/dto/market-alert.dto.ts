/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { MarketAlert } from '../entities/market-alert.entity'
import { MarketAlertSeverity, MarketAlertType } from '../enums/market-alert-type.enum'

@ApiSchema({ name: 'MarketAlertsQuery' })
export class MarketAlertsQueryDto {
  @ApiPropertyOptional({ description: 'open (default) returns unresolved alerts only', enum: ['open', 'all'] })
  @IsOptional()
  @IsIn(['open', 'all'])
  state?: 'open' | 'all'
}

@ApiSchema({ name: 'MarketAlert' })
export class MarketAlertDto {
  @ApiProperty()
  id: string

  @ApiProperty({ enum: MarketAlertType })
  type: MarketAlertType

  @ApiProperty({ enum: MarketAlertSeverity })
  severity: MarketAlertSeverity

  @ApiProperty()
  message: string

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt: Date | null

  static fromEntity(alert: MarketAlert): MarketAlertDto {
    return {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      createdAt: alert.createdAt,
      resolvedAt: alert.resolvedAt,
    }
  }
}

@ApiSchema({ name: 'MarketAlertsResponse' })
export class MarketAlertsResponseDto {
  @ApiProperty({ type: [MarketAlertDto] })
  items: MarketAlertDto[]
}
