/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { OrganizationModule } from '../organization/organization.module'
import { RegionModule } from '../region/region.module'
import { Region } from '../region/entities/region.entity'
import { Runner } from '../sandbox/entities/runner.entity'
import { RunnerPricing } from '../provider/entities/runner-pricing.entity'
import { SandboxUsagePeriod } from '../usage/entities/sandbox-usage-period.entity'
import { SandboxUsagePeriodArchive } from '../usage/entities/sandbox-usage-period-archive.entity'
import { MarketLease } from './entities/market-lease.entity'
import { MarketListing } from './entities/market-listing.entity'
import { MarketController } from './controllers/market.controller'
import { ProviderMarketController } from './controllers/provider-market.controller'
import { MarketLeasesService } from './services/market-leases.service'
import { MarketListingsService } from './services/market-listings.service'
import { MarketUsageService } from './services/market-usage.service'

@Module({
  imports: [
    OrganizationModule,
    RegionModule,
    TypeOrmModule.forFeature([
      MarketListing,
      MarketLease,
      Region,
      Runner,
      RunnerPricing,
      SandboxUsagePeriod,
      SandboxUsagePeriodArchive,
    ]),
  ],
  controllers: [MarketController, ProviderMarketController],
  providers: [MarketListingsService, MarketLeasesService, MarketUsageService],
  exports: [MarketListingsService, MarketLeasesService, MarketUsageService],
})
export class MarketModule {}
