/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOAuth2, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { RequiredSystemRole } from '../../user/decorators/required-system-role.decorator'
import { SystemRole } from '../../user/enums/system-role.enum'
import { AdminRecomputeMarketChargesDto, AdminMarketTopupDto } from '../dto/admin-market.dto'
import { MarketCreditEntryDto, MarketCreditResponseDto } from '../dto/market-credit.dto'
import { MarketChargingService } from '../services/market-charging.service'
import { MarketCreditService } from '../services/market-credit.service'

@Controller('admin/market')
@ApiTags('admin')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@RequiredSystemRole(SystemRole.ADMIN)
@UseGuards(AuthenticatedRateLimitGuard)
export class AdminMarketController {
  constructor(
    private readonly creditService: MarketCreditService,
    private readonly chargingService: MarketChargingService,
  ) {}

  @Post('credits/topup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Credit a consumer organization market balance',
    operationId: 'adminTopupMarketCredit',
    description: 'Platform only: manual credit for self-hosted deployments where no payment provider is wired.',
  })
  @ApiResponse({ status: 200, type: MarketCreditResponseDto })
  async topUp(@Body() dto: AdminMarketTopupDto): Promise<MarketCreditResponseDto> {
    await this.creditService.topUp(dto.organizationId, dto.amountCents, dto.description)
    return this.credit(dto.organizationId)
  }

  @Get('credits/:organizationId')
  @ApiOperation({
    summary: 'Read a organization market balance and recent ledger entries',
    operationId: 'adminGetMarketCredit',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketCreditResponseDto })
  async credit(@Param('organizationId') organizationId: string): Promise<MarketCreditResponseDto> {
    const balance = await this.creditService.getBalance(organizationId)
    const entries = await this.creditService.listEntries(organizationId)
    return {
      balanceCents: balance.balanceCents,
      currency: balance.currency,
      entries: entries.map(MarketCreditEntryDto.fromEntity),
    }
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Market operations overview',
    operationId: 'adminGetMarketOverview',
    description: 'Platform only: listing/lease/charge totals and organizations with a negative market balance.',
  })
  @ApiResponse({ status: 200 })
  async overview(): Promise<Awaited<ReturnType<MarketChargingService['getOverview']>>> {
    return this.chargingService.getOverview()
  }

  @Post('charges/recompute')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Charge consumer market usage for a UTC day',
    operationId: 'adminRecomputeMarketCharges',
    description:
      'Platform only: computes usage charges for the given UTC day (defaults to the previous UTC day). Idempotent per lease/day.',
  })
  @ApiResponse({ status: 200, description: 'Number of leases charged' })
  async recompute(@Body() dto: AdminRecomputeMarketChargesDto): Promise<{ charged: number }> {
    const charged = await this.chargingService.recomputeDay(dto.day)
    return { charged }
  }
}
