/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiHeader, ApiOAuth2, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { CustomHeaders } from '../../common/constants/header.constants'
import { IsOrganizationAuthContext } from '../../common/decorators/auth-context.decorator'
import { OrganizationAuthContext } from '../../common/interfaces/organization-auth-context.interface'
import { RequiredOrganizationResourcePermissions } from '../../organization/decorators/required-organization-resource-permissions.decorator'
import { OrganizationResourcePermission } from '../../organization/enums/organization-resource-permission.enum'
import { OrganizationAuthContextGuard } from '../../organization/guards/organization-auth-context.guard'
import { MarketLeaseDto, MarketLeasesResponseDto, CreateMarketLeaseDto } from '../dto/market-lease.dto'
import { MarketListingsQueryDto, MarketListingsResponseDto } from '../dto/market-listing.dto'
import { MarketAlertDto, MarketAlertsQueryDto, MarketAlertsResponseDto } from '../dto/market-alert.dto'
import { CreateMarketBidDto, MarketBidDto, MarketBidsResponseDto } from '../dto/market-bid.dto'
import { MarketSlaEventDto, MarketSlaEventsQueryDto, MarketSlaEventsResponseDto } from '../dto/market-sla.dto'
import {
  MarketChargesQueryDto,
  MarketChargesResponseDto,
  MarketCreditEntryDto,
  MarketCreditResponseDto,
  MarketUsageChargeDto,
} from '../dto/market-credit.dto'
import { MarketUsageQueryDto, MarketUsageResponseDto } from '../dto/market-usage.dto'
import { MarketLeasesService } from '../services/market-leases.service'
import { MarketListingsService } from '../services/market-listings.service'
import { MarketAlertsService } from '../services/market-alerts.service'
import { MarketBidsService } from '../services/market-bids.service'
import { MarketChargingService } from '../services/market-charging.service'
import { MarketCreditService } from '../services/market-credit.service'
import { MarketUsageService } from '../services/market-usage.service'

@Controller('market')
@ApiTags('market')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@ApiHeader(CustomHeaders.ORGANIZATION_ID)
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@UseGuards(AuthenticatedRateLimitGuard)
@UseGuards(OrganizationAuthContextGuard)
export class MarketController {
  constructor(
    private readonly listingsService: MarketListingsService,
    private readonly leasesService: MarketLeasesService,
    private readonly usageService: MarketUsageService,
    private readonly creditService: MarketCreditService,
    private readonly chargingService: MarketChargingService,
    private readonly alertsService: MarketAlertsService,
    private readonly bidsService: MarketBidsService,
  ) {}

  @Get('listings')
  @ApiOperation({
    summary: 'Browse published compute capacity listings',
    operationId: 'listMarketListings',
    description: 'Returns every published public listing on the platform with prices and capacity.',
  })
  @ApiResponse({ status: 200, type: MarketListingsResponseDto })
  async listListings(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: MarketListingsQueryDto,
  ): Promise<MarketListingsResponseDto> {
    const items = await this.listingsService.listPublic(authContext.organizationId, { sort: query.sort })
    return { items }
  }

  @Get('leases')
  @ApiOperation({
    summary: 'List leases of the organization',
    operationId: 'listMarketLeases',
    description: 'Returns the leases the organization holds on market listings.',
  })
  @ApiResponse({ status: 200, type: MarketLeasesResponseDto })
  async listLeases(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
  ): Promise<MarketLeasesResponseDto> {
    const items = await this.leasesService.listForConsumer(authContext.organizationId)
    return { items }
  }

  @Post('leases')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Rent capacity from a market listing',
    operationId: 'openMarketLease',
    description:
      'Opens (or resizes) a lease on a published listing. The consumer organization immediately receives a region quota so sandboxes can be scheduled on the provider region.',
  })
  @ApiResponse({ status: 201, type: MarketLeaseDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_SANDBOXES])
  async openLease(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Body() dto: CreateMarketLeaseDto,
  ): Promise<MarketLeaseDto> {
    return this.leasesService.open(authContext.organizationId, dto)
  }

  @Post('leases/:id/close')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close a market lease',
    operationId: 'closeMarketLease',
    description: 'Releases the lease and revokes the organization region quota granted by it.',
  })
  @ApiParam({ name: 'id', description: 'Lease ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketLeaseDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_SANDBOXES])
  async closeLease(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<MarketLeaseDto> {
    return this.leasesService.close(authContext.organizationId, id)
  }

  @Get('usage')
  @ApiOperation({
    summary: 'Consumer usage and amount owed on market capacity',
    operationId: 'getMarketUsage',
    description:
      'Aggregates the organization usage on leased market regions and prices it with the lease price snapshot. M1 is display-only (no deduction).',
  })
  @ApiResponse({ status: 200, type: MarketUsageResponseDto })
  async getUsage(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: MarketUsageQueryDto,
  ): Promise<MarketUsageResponseDto> {
    return this.usageService.getUsage(authContext.organizationId, query)
  }

  @Get('credit')
  @ApiOperation({
    summary: 'Read the organization market credit balance and ledger',
    operationId: 'getMarketCredit',
    description: 'Returns the consumer credit balance and the most recent ledger entries (top-ups and usage charges).',
  })
  @ApiResponse({ status: 200, type: MarketCreditResponseDto })
  async getCredit(@IsOrganizationAuthContext() authContext: OrganizationAuthContext): Promise<MarketCreditResponseDto> {
    const balance = await this.creditService.getBalance(authContext.organizationId)
    const entries = await this.creditService.listEntries(authContext.organizationId)
    return {
      balanceCents: balance.balanceCents,
      currency: balance.currency,
      entries: entries.map(MarketCreditEntryDto.fromEntity),
    }
  }

  @Get('alerts')
  @ApiOperation({
    summary: 'List market risk alerts of the organization',
    operationId: 'listMarketAlerts',
    description: 'Low / negative balance alerts raised by market risk control.',
  })
  @ApiResponse({ status: 200, type: MarketAlertsResponseDto })
  async listAlerts(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: MarketAlertsQueryDto,
  ): Promise<MarketAlertsResponseDto> {
    const alerts = await this.alertsService.list(authContext.organizationId, query.state ?? 'open')
    return { items: alerts.map(MarketAlertDto.fromEntity) }
  }

  @Get('bids')
  @ApiOperation({
    summary: 'List price bids submitted by the organization',
    operationId: 'listMarketBids',
  })
  @ApiResponse({ status: 200, type: MarketBidsResponseDto })
  async listBids(@IsOrganizationAuthContext() authContext: OrganizationAuthContext): Promise<MarketBidsResponseDto> {
    const items = await this.bidsService.listForConsumer(authContext.organizationId)
    return { items }
  }

  @Post('bids')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Submit a price bid for a market listing',
    operationId: 'createMarketBid',
    description: 'The provider can accept the bid to turn it into a lease priced with the bid snapshot.',
  })
  @ApiResponse({ status: 201, type: MarketBidDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_SANDBOXES])
  async createBid(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Body() dto: CreateMarketBidDto,
  ): Promise<MarketBidDto> {
    return this.bidsService.create(authContext.organizationId, dto)
  }

  @Post('bids/:id/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a pending price bid', operationId: 'withdrawMarketBid' })
  @ApiParam({ name: 'id', description: 'Bid ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketBidDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_SANDBOXES])
  async withdrawBid(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<MarketBidDto> {
    return this.bidsService.withdraw(authContext.organizationId, id)
  }

  @Get('sla-events')
  @ApiOperation({
    summary: 'List SLA breach compensations of the organization',
    operationId: 'listMarketSlaEvents',
  })
  @ApiResponse({ status: 200, type: MarketSlaEventsResponseDto })
  async listSlaEvents(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: MarketSlaEventsQueryDto,
  ): Promise<MarketSlaEventsResponseDto> {
    const events = await this.chargingService.listSlaEvents(authContext.organizationId, query)
    return { items: events.map(MarketSlaEventDto.fromEntity) }
  }

  @Get('charges')
  @ApiOperation({
    summary: 'List settled market usage charges of the organization',
    operationId: 'listMarketCharges',
    description: 'Returns per-lease per-day usage charges with platform commission breakdown.',
  })
  @ApiResponse({ status: 200, type: MarketChargesResponseDto })
  async listCharges(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: MarketChargesQueryDto,
  ): Promise<MarketChargesResponseDto> {
    const { items, listingNames } = await this.chargingService.listCharges(authContext.organizationId, query)
    return {
      items: items.map((charge) => MarketUsageChargeDto.fromEntity(charge, listingNames.get(charge.listingId))),
    }
  }
}
