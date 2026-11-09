/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { MarketAlertSeverity, MarketAlertType } from '../../market/enums/market-alert-type.enum'
import { MarketAlertsService } from '../../market/services/market-alerts.service'
import { MarketCreditService } from '../../market/services/market-credit.service'
import { MarketLeasesService } from '../../market/services/market-leases.service'
import { Sandbox } from '../entities/sandbox.entity'
import { SandboxState } from '../enums/sandbox-state.enum'
import { SandboxService } from './sandbox.service'

function lowBalanceThresholdCents(): number {
  const raw = process.env.MARKET_LOW_BALANCE_CENTS
  const parsed = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 100
}

/**
 * Market risk control (M4):
 * - low balance -> warning alert
 * - negative balance -> critical alert + stop consumer sandboxes on market regions + close leases
 * - recovery -> alerts resolved
 *
 * Runs inside SandboxModule because stopping sandboxes must go through SandboxService.
 */
@Injectable()
export class MarketRiskService {
  private readonly logger = new Logger(MarketRiskService.name)

  constructor(
    @InjectRepository(Sandbox)
    private readonly sandboxRepository: Repository<Sandbox>,
    private readonly sandboxService: SandboxService,
    private readonly creditService: MarketCreditService,
    private readonly leasesService: MarketLeasesService,
    private readonly alertsService: MarketAlertsService,
  ) {}

  @Cron('*/5 * * * *', { name: 'market-risk-control' })
  async runRiskControl(): Promise<void> {
    try {
      const threshold = lowBalanceThresholdCents()
      const belowThreshold = await this.creditService.getBalancesBelow(threshold)
      const belowOrganizationIds = new Set(belowThreshold.map((row) => row.organizationId))

      for (const { organizationId, balanceCents } of belowThreshold) {
        if (balanceCents < 0) {
          await this.alertsService.raise(
            organizationId,
            MarketAlertType.NEGATIVE_BALANCE,
            MarketAlertSeverity.CRITICAL,
            `市场余额为负（${balanceCents} 分），已停止市场 region 沙箱并关闭租约`,
            { balanceCents, thresholdCents: threshold },
          )
          await this.enforceNegativeBalance(organizationId)
        } else {
          await this.alertsService.raise(
            organizationId,
            MarketAlertType.LOW_BALANCE,
            MarketAlertSeverity.WARNING,
            `市场余额偏低（${balanceCents} 分 < 预警阈值 ${threshold} 分），请及时充值`,
            { balanceCents, thresholdCents: threshold },
          )
        }
      }

      const organizationsWithOpenAlerts = await this.alertsService.getOrganizationsWithOpenAlerts()
      for (const organizationId of organizationsWithOpenAlerts) {
        if (!belowOrganizationIds.has(organizationId)) {
          const resolved = await this.alertsService.resolveAll(organizationId)
          if (resolved > 0) {
            this.logger.log(`Market alerts resolved for organization ${organizationId}`)
          }
        }
      }
    } catch (error) {
      this.logger.error('Market risk control failed', error)
    }
  }

  private async enforceNegativeBalance(organizationId: string): Promise<void> {
    const leases = await this.leasesService.listActiveForConsumer(organizationId)
    for (const { lease, listing } of leases) {
      const sandboxes = await this.sandboxRepository.find({
        where: {
          organizationId,
          region: listing.regionId,
          state: In([SandboxState.STARTED, SandboxState.PAUSED]),
        },
      })
      for (const sandbox of sandboxes) {
        try {
          await this.sandboxService.stop(sandbox.id, organizationId, true)
          this.logger.warn(`Stopped sandbox ${sandbox.id} of ${organizationId}: negative market balance`)
        } catch (error) {
          this.logger.warn(`Failed to stop sandbox ${sandbox.id}: ${(error as Error).message}`)
        }
      }
      await this.leasesService.closeForRisk(lease.id, 'Negative market balance')
    }
  }
}
