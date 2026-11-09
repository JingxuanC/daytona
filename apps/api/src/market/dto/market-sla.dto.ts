/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsOptional } from 'class-validator'
import { MarketSlaEvent } from '../entities/market-sla-event.entity'

@ApiSchema({ name: 'MarketSlaEventsQuery' })
export class MarketSlaEventsQueryDto {
  @ApiPropertyOptional({ description: 'Start date (inclusive), ISO 8601 date. Defaults to 7 days ago.' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ description: 'End date (inclusive), ISO 8601 date. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  to?: string
}

@ApiSchema({ name: 'MarketSlaEvent' })
export class MarketSlaEventDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  leaseId: string

  @ApiProperty()
  periodStart: string

  @ApiProperty()
  availabilityPct: number

  @ApiProperty()
  requiredAvailabilityPct: number

  @ApiProperty()
  compensationCents: number

  @ApiProperty()
  currency: string

  @ApiProperty()
  reason: string

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  static fromEntity(event: MarketSlaEvent): MarketSlaEventDto {
    return {
      id: event.id,
      leaseId: event.leaseId,
      periodStart: event.periodStart,
      availabilityPct: event.availabilityPct,
      requiredAvailabilityPct: event.requiredAvailabilityPct,
      compensationCents: event.compensationCents,
      currency: event.currency,
      reason: event.reason,
      createdAt: event.createdAt,
    }
  }
}

@ApiSchema({ name: 'MarketSlaEventsResponse' })
export class MarketSlaEventsResponseDto {
  @ApiProperty({ type: [MarketSlaEventDto] })
  items: MarketSlaEventDto[]
}
