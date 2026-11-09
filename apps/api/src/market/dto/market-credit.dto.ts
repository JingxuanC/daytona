/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsOptional } from 'class-validator'
import { MarketCreditEntryType } from '../enums/market-credit-entry-type.enum'
import { MarketCreditEntry } from '../entities/market-credit-entry.entity'
import { MarketUsageCharge } from '../entities/market-usage-charge.entity'

@ApiSchema({ name: 'MarketCreditEntry' })
export class MarketCreditEntryDto {
  @ApiProperty()
  id: string

  @ApiProperty({ enum: MarketCreditEntryType })
  type: MarketCreditEntryType

  @ApiProperty({ description: 'Signed amount in integer cents (positive credit, negative charge)' })
  amountCents: number

  @ApiProperty()
  balanceAfterCents: number

  @ApiProperty()
  currency: string

  @ApiPropertyOptional({ nullable: true })
  description: string | null

  @ApiPropertyOptional({ nullable: true })
  referenceType: string | null

  @ApiPropertyOptional({ nullable: true })
  referenceId: string | null

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  static fromEntity(entry: MarketCreditEntry): MarketCreditEntryDto {
    return {
      id: entry.id,
      type: entry.type,
      amountCents: entry.amountCents,
      balanceAfterCents: entry.balanceAfterCents,
      currency: entry.currency,
      description: entry.description ?? null,
      referenceType: entry.referenceType ?? null,
      referenceId: entry.referenceId ?? null,
      createdAt: entry.createdAt,
    }
  }
}

@ApiSchema({ name: 'MarketCredit' })
export class MarketCreditResponseDto {
  @ApiProperty({ description: 'Current balance in integer cents', example: 1000 })
  balanceCents: number

  @ApiProperty({ example: 'CNY' })
  currency: string

  @ApiProperty({ type: [MarketCreditEntryDto] })
  entries: MarketCreditEntryDto[]
}

@ApiSchema({ name: 'MarketChargesQuery' })
export class MarketChargesQueryDto {
  @ApiPropertyOptional({ description: 'Start date (inclusive), ISO 8601 date. Defaults to 7 days ago.' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ description: 'End date (inclusive), ISO 8601 date. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  to?: string
}

@ApiSchema({ name: 'MarketUsageCharge' })
export class MarketUsageChargeDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  leaseId: string

  @ApiProperty()
  listingId: string

  @ApiPropertyOptional({ nullable: true })
  listingName: string | null

  @ApiProperty({ description: 'UTC day the charge belongs to' })
  periodStart: string

  @ApiProperty()
  cpuHours: number

  @ApiProperty()
  memoryGiBHours: number

  @ApiProperty()
  diskGiBHours: number

  @ApiProperty()
  gpuHours: number

  @ApiProperty({ description: 'Charged amount in integer cents' })
  amountCents: number

  @ApiProperty({ description: 'Platform commission in integer cents' })
  platformFeeCents: number

  @ApiProperty({ description: 'Provider net revenue in integer cents' })
  providerNetCents: number

  @ApiProperty()
  currency: string

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date

  static fromEntity(charge: MarketUsageCharge, listingName?: string | null): MarketUsageChargeDto {
    return {
      id: charge.id,
      leaseId: charge.leaseId,
      listingId: charge.listingId,
      listingName: listingName ?? null,
      periodStart: charge.periodStart,
      cpuHours: charge.cpuHours,
      memoryGiBHours: charge.memoryGiBHours,
      diskGiBHours: charge.diskGiBHours,
      gpuHours: charge.gpuHours,
      amountCents: charge.amountCents,
      platformFeeCents: charge.platformFeeCents,
      providerNetCents: charge.providerNetCents,
      currency: charge.currency,
      createdAt: charge.createdAt,
    }
  }
}

@ApiSchema({ name: 'MarketChargesResponse' })
export class MarketChargesResponseDto {
  @ApiProperty({ type: [MarketUsageChargeDto] })
  items: MarketUsageChargeDto[]
}
