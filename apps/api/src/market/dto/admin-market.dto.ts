/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator'

@ApiSchema({ name: 'AdminMarketTopup' })
export class AdminMarketTopupDto {
  @ApiProperty({ description: 'Organization that receives the credit' })
  @IsUUID()
  organizationId: string

  @ApiProperty({ description: 'Amount to credit in integer cents', example: 10000, minimum: 1 })
  @IsInt()
  @Min(1)
  amountCents: number

  @ApiPropertyOptional({ description: 'Free-form note for this manual top-up' })
  @IsOptional()
  @IsString()
  description?: string
}

@ApiSchema({ name: 'AdminUpdateMarketSettings' })
export class AdminUpdateMarketSettingsDto {
  @ApiProperty({
    description: 'Platform commission in basis points (0-10000)',
    example: 1000,
    minimum: 0,
    maximum: 10000,
  })
  @IsInt()
  @Min(0)
  platformFeeBps: number
}

@ApiSchema({ name: 'AdminRecomputeMarketCharges' })
export class AdminRecomputeMarketChargesDto {
  @ApiPropertyOptional({
    description: 'UTC day to charge, in YYYY-MM-DD format. Defaults to the previous UTC day.',
    example: '2026-11-09',
  })
  @IsOptional()
  @IsDateString()
  day?: string
}
