/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RegionModule } from '../region/region.module'
import { Runner } from '../sandbox/entities/runner.entity'
import { SandboxModule } from '../sandbox/sandbox.module'
import { SandboxUsagePeriodArchive } from '../usage/entities/sandbox-usage-period-archive.entity'
import { SandboxUsagePeriod } from '../usage/entities/sandbox-usage-period.entity'
import { AdminProviderController } from './controllers/admin-provider.controller'
import { ProviderController } from './controllers/provider.controller'
import { RunnerAlert } from './entities/runner-alert.entity'
import { RunnerDailyMetric } from './entities/runner-daily-metric.entity'
import { RunnerPricing } from './entities/runner-pricing.entity'
import { SettlementSandboxLine } from './entities/settlement-sandbox-line.entity'
import { SettlementPeriod } from './entities/settlement-period.entity'
import { ProviderAlertsService } from './services/provider-alerts.service'
import { ProviderEarningsService } from './services/provider-earnings.service'
import { ProviderMetricsService } from './services/provider-metrics.service'
import { ProviderNodesService } from './services/provider-nodes.service'
import { ProviderPricingService } from './services/provider-pricing.service'
import { ProviderSettlementService } from './services/provider-settlement.service'
import { ProviderUsageService } from './services/provider-usage.service'

@Module({
  imports: [
    SandboxModule,
    RegionModule,
    TypeOrmModule.forFeature([
      SandboxUsagePeriod,
      SandboxUsagePeriodArchive,
      Runner,
      RunnerPricing,
      RunnerDailyMetric,
      RunnerAlert,
      SettlementPeriod,
      SettlementSandboxLine,
    ]),
  ],
  controllers: [ProviderController, AdminProviderController],
  providers: [
    ProviderNodesService,
    ProviderUsageService,
    ProviderPricingService,
    ProviderEarningsService,
    ProviderSettlementService,
    ProviderAlertsService,
    ProviderMetricsService,
  ],
  exports: [
    ProviderNodesService,
    ProviderUsageService,
    ProviderPricingService,
    ProviderEarningsService,
    ProviderSettlementService,
    ProviderAlertsService,
    ProviderMetricsService,
  ],
})
export class ProviderModule {}
