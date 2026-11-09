/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Controller, HttpCode, Param, Post, Body, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOAuth2, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { RequiredSystemRole } from '../../user/decorators/required-system-role.decorator'
import { SystemRole } from '../../user/enums/system-role.enum'
import { AdminRecomputeProviderSettlementsDto } from '../dto/admin-recompute-settlements.dto'
import { ProviderSettlementService } from '../services/provider-settlement.service'

@Controller('admin/provider')
@ApiTags('admin')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@RequiredSystemRole(SystemRole.ADMIN)
@UseGuards(AuthenticatedRateLimitGuard)
export class AdminProviderController {
  constructor(private readonly providerSettlementService: ProviderSettlementService) {}

  @Post('settlements/:id/settle')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Mark a provider settlement as settled',
    operationId: 'adminSettleProviderSettlement',
    description: 'Platform only: marks a PENDING provider settlement as SETTLED.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the settlement period',
    type: 'string',
  })
  @ApiResponse({
    status: 204,
    description: 'The settlement has been marked as settled',
  })
  async settle(@Param('id') id: string): Promise<void> {
    await this.providerSettlementService.markSettled(id)
  }

  @Post('settlements/recompute')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recompute provider settlements for a UTC day',
    operationId: 'adminRecomputeProviderSettlements',
    description:
      'Platform only: reprices PENDING settlements for the given UTC day (defaults to the previous UTC day).',
  })
  @ApiResponse({
    status: 200,
    description: 'Number of settlement rows that were recomputed',
  })
  async recompute(@Body() dto: AdminRecomputeProviderSettlementsDto): Promise<{ settled: number }> {
    const settled = await this.providerSettlementService.recomputeDay(dto.day)
    return { settled }
  }
}
