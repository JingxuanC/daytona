/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsDateString, IsOptional } from 'class-validator'

@ApiSchema({ name: 'AdminRecomputeProviderSettlements' })
export class AdminRecomputeProviderSettlementsDto {
  @ApiPropertyOptional({
    description:
      'UTC day to reprice, in YYYY-MM-DD format. Defaults to the previous UTC day. Only PENDING settlements are recomputed.',
    example: '2026-11-08',
  })
  @IsOptional()
  @IsDateString()
  day?: string
}
