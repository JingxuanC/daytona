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
import { MarketLeasesResponseDto } from '../dto/market-lease.dto'
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
