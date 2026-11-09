/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
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
import {
  CreateMarketListingDto,
  MarketListingDto,
  MarketListingsResponseDto,
  UpdateMarketListingDto,
} from '../dto/market-listing.dto'
import { MarketLeaseDto, MarketLeasesResponseDto } from '../dto/market-lease.dto'
import { MarketBidDto, MarketBidsResponseDto } from '../dto/market-bid.dto'
import { MarketBidsService } from '../services/market-bids.service'
import { MarketLeasesService } from '../services/market-leases.service'
import { MarketListingsService } from '../services/market-listings.service'

@Controller('provider/market')
@ApiTags('provider')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@ApiHeader(CustomHeaders.ORGANIZATION_ID)
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@UseGuards(AuthenticatedRateLimitGuard)
@UseGuards(OrganizationAuthContextGuard)
export class ProviderMarketController {
  constructor(
    private readonly listingsService: MarketListingsService,
    private readonly leasesService: MarketLeasesService,
    private readonly bidsService: MarketBidsService,
  ) {}

  @Get('listings')
  @ApiOperation({
    summary: 'List market listings published by the organization',
    operationId: 'listProviderMarketListings',
  })
  @ApiResponse({ status: 200, type: MarketListingsResponseDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listListings(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
  ): Promise<MarketListingsResponseDto> {
    const items = await this.listingsService.listForProvider(authContext.organizationId)
    return { items }
  }

  @Post('listings')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Publish (or update) a compute capacity listing for one of the organization regions',
    operationId: 'publishProviderMarketListing',
    description:
      'Enables quota enforcement on the region, keeps a provider self quota big enough to run its own sandboxes and syncs runner pricing used by settlement.',
  })
  @ApiResponse({ status: 201, type: MarketListingDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async publishListing(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Body() dto: CreateMarketListingDto,
  ): Promise<MarketListingDto> {
    return this.listingsService.publish(authContext.organizationId, dto)
  }

  @Patch('listings/:id')
  @ApiOperation({
    summary: 'Update prices, capacity or status of a market listing',
    operationId: 'updateProviderMarketListing',
    description: 'Price changes only affect future leases: existing leases keep their price snapshot.',
  })
  @ApiParam({ name: 'id', description: 'Listing ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketListingDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async updateListing(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateMarketListingDto,
  ): Promise<MarketListingDto> {
    return this.listingsService.update(authContext.organizationId, id, dto)
  }

  @Delete('listings/:id')
  @ApiOperation({
    summary: 'Retire a market listing',
    operationId: 'retireProviderMarketListing',
  })
  @ApiParam({ name: 'id', description: 'Listing ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketListingDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async retireListing(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<MarketListingDto> {
    return this.listingsService.retire(authContext.organizationId, id)
  }

  @Get('bids')
  @ApiOperation({
    summary: 'List price bids received on the organization market listings',
    operationId: 'listProviderMarketBids',
  })
  @ApiResponse({ status: 200, type: MarketBidsResponseDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listBids(@IsOrganizationAuthContext() authContext: OrganizationAuthContext): Promise<MarketBidsResponseDto> {
    const items = await this.bidsService.listForProvider(authContext.organizationId)
    return { items }
  }

  @Post('bids/:id/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept a consumer price bid (creates a lease at the bid price)',
    operationId: 'acceptProviderMarketBid',
  })
  @ApiParam({ name: 'id', description: 'Bid ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketLeaseDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async acceptBid(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<MarketLeaseDto> {
    return this.bidsService.accept(authContext.organizationId, id)
  }

  @Post('bids/:id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject a consumer price bid',
    operationId: 'rejectProviderMarketBid',
  })
  @ApiParam({ name: 'id', description: 'Bid ID', type: 'string' })
  @ApiResponse({ status: 200, type: MarketBidDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async rejectBid(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<MarketBidDto> {
    return this.bidsService.reject(authContext.organizationId, id)
  }

  @Get('leases')
  @ApiOperation({
    summary: 'List leases held against the organization market listings',
    operationId: 'listProviderMarketLeases',
  })
  @ApiResponse({ status: 200, type: MarketLeasesResponseDto })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listLeases(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
  ): Promise<MarketLeasesResponseDto> {
    const items = await this.leasesService.listForProvider(authContext.organizationId)
    return { items }
  }
}
