/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { RequiredSystemRole } from '../../user/decorators/required-system-role.decorator'
import { SystemRole } from '../../user/enums/system-role.enum'
import { MarketRiskService } from '../services/market-risk.service'

@Controller('admin/market/risk')
@ApiTags('admin')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@RequiredSystemRole(SystemRole.ADMIN)
@UseGuards(AuthenticatedRateLimitGuard)
export class AdminMarketRiskController {
  constructor(private readonly riskService: MarketRiskService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run market risk control immediately',
    operationId: 'adminRunMarketRiskControl',
    description:
      'Platform only: evaluates low/negative market balances, raises alerts, stops sandboxes and closes leases when negative.',
  })
  @ApiResponse({ status: 200, description: 'Risk control finished' })
  async run(): Promise<{ ok: true }> {
    await this.riskService.runRiskControl()
    return { ok: true }
  }
}
