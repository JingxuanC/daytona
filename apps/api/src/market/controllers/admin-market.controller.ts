/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOAuth2, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { RequiredSystemRole } from '../../user/decorators/required-system-role.decorator'
import { SystemRole } from '../../user/enums/system-role.enum'
import {
  AdminMarketTopupDto,
  AdminRecomputeMarketChargesDto,
  AdminUpdateMarketSettingsDto,
} from '../dto/admin-market.dto'
import { MarketCreditEntryDto, MarketCreditResponseDto } from '../dto/market-credit.dto'
import { MarketChargingService } from '../services/market-charging.service'
import { MarketCreditService } from '../services/market-credit.service'
import { MarketSettingsService } from '../services/market-settings.service'

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
    private readonly settingsService: MarketSettingsService,
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
    description: 'Platform only: listing/lease/charge totals, platform fee and organizations with a negative balance.',
  })
  @ApiResponse({ status: 200 })
  async overview(): Promise<Awaited<ReturnType<MarketChargingService['getOverview']>> & { platformFeeBps: number }> {
    const [overview, platformFeeBps] = await Promise.all([
      this.chargingService.getOverview(),
      this.settingsService.getPlatformFeeBps(),
    ])
    return { ...overview, platformFeeBps }
  }

  @Get('settings')
  @ApiOperation({
    summary: 'Read runtime market settings',
    operationId: 'adminGetMarketSettings',
    description: 'Platform only: currently returns the platform commission in basis points.',
  })
  @ApiResponse({ status: 200 })
  async getSettings(): Promise<{ platformFeeBps: number }> {
    return { platformFeeBps: await this.settingsService.getPlatformFeeBps() }
  }

  @Put('settings')
  @ApiOperation({
    summary: 'Update runtime market settings',
    operationId: 'adminUpdateMarketSettings',
    description: 'Platform only: persists the platform commission so it applies without a restart.',
  })
  @ApiResponse({ status: 200 })
  async updateSettings(@Body() dto: AdminUpdateMarketSettingsDto): Promise<{ platformFeeBps: number }> {
    const platformFeeBps = await this.settingsService.setPlatformFeeBps(dto.platformFeeBps)
    return { platformFeeBps }
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
