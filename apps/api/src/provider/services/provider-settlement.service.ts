/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Cron } from '@nestjs/schedule'
import { setTimeout as sleep } from 'timers/promises'
import { Between, Repository } from 'typeorm'
import { TrackableJobExecutions } from '../../common/interfaces/trackable-job-executions'
import { RegionService } from '../../region/services/region.service'
import { RegionType } from '../../region/enums/region-type.enum'
import { RedisLockProvider } from '../../sandbox/common/redis-lock.provider'
import { RunnerService } from '../../sandbox/services/runner.service'
import {
  ProviderSettlementDetailDto,
  ProviderSettlementItemDto,
  ProviderSettlementLineDto,
  ProviderSettlementsQueryDto,
  ProviderSettlementsResponseDto,
  UpdateProviderSettlementStatusDto,
} from '../dto/provider-settlement.dto'
import { RunnerPricing } from '../entities/runner-pricing.entity'
import { SettlementSandboxLine } from '../entities/settlement-sandbox-line.entity'
import { SettlementPeriod, SettlementStatus } from '../entities/settlement-period.entity'
import { DAY_MS, formatUtcDay, resolveDateRange, round } from '../utils/date-range.util'
import { computeAmountCents } from '../utils/pricing.util'
import { MarketSettingsService } from '../../market/services/market-settings.service'
import { ProviderPricingService } from './provider-pricing.service'
import { ProviderUsageService } from './provider-usage.service'

const SETTLEMENT_LOCK_KEY = 'provider-daily-settlement'
const DEFAULT_LIMIT = 200

const ALLOWED_STATUS_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  [SettlementStatus.PENDING]: [],
  [SettlementStatus.SETTLED]: [SettlementStatus.WITHDRAWING],
  [SettlementStatus.WITHDRAWING]: [SettlementStatus.WITHDRAWN],
  [SettlementStatus.WITHDRAWN]: [],
}

interface SettlementTarget {
  organizationId: string
  runnerId: string
  runnerName: string
}

@Injectable()
export class ProviderSettlementService implements TrackableJobExecutions, OnApplicationShutdown {
  activeJobs = new Set<string>()
  private readonly logger = new Logger(ProviderSettlementService.name)

  constructor(
    @InjectRepository(SettlementPeriod)
    private readonly settlementRepository: Repository<SettlementPeriod>,
    @InjectRepository(SettlementSandboxLine)
    private readonly settlementLineRepository: Repository<SettlementSandboxLine>,
    private readonly runnerService: RunnerService,
    private readonly regionService: RegionService,
    private readonly redisLockProvider: RedisLockProvider,
    private readonly providerUsageService: ProviderUsageService,
    private readonly providerPricingService: ProviderPricingService,
    private readonly marketSettingsService: MarketSettingsService,
  ) {}

  async onApplicationShutdown() {
    while (this.activeJobs.size > 0) {
      this.logger.log(`Waiting for ${this.activeJobs.size} active provider settlement jobs to finish`)
      await sleep(1000)
    }
  }

  /**
   * Prices the usage of the previous UTC day for every compute node that has pricing
   * configured. Runs once per day; safe to re-run for the same day while the settlement is
   * still PENDING.
   */
  @Cron('0 0 1 * * *', { name: 'provider-daily-settlement' })
  async handleDailySettlement(): Promise<void> {
    if (!(await this.redisLockProvider.lock(SETTLEMENT_LOCK_KEY, 300))) {
      return
    }

    try {
      const dayLabel = formatUtcDay(new Date(Date.now() - DAY_MS))
      this.logger.log(`Running provider daily settlement for ${dayLabel}`)
      await this.settleDay(dayLabel)
    } catch (error) {
      this.logger.error('Error running provider daily settlement', error)
    } finally {
      await this.redisLockProvider.unlock(SETTLEMENT_LOCK_KEY)
    }
  }

  /**
   * Prices and persists the given UTC day. Existing PENDING settlements are updated,
   * settled/withdrawn ones are left untouched.
   */
  async settleDay(dayLabel: string, organizationId?: string): Promise<number> {
    const targets = await this.resolveTargets(organizationId)
    const feeBps = await this.marketSettingsService.getPlatformFeeBps()
    const pricingByOrganization = new Map<string, Map<string, RunnerPricing>>()
    let settled = 0

    for (const target of targets) {
      let pricingMap = pricingByOrganization.get(target.organizationId)
      if (!pricingMap) {
        pricingMap = await this.providerPricingService.getPricingMap(target.organizationId)
        pricingByOrganization.set(target.organizationId, pricingMap)
      }

      const pricing = pricingMap.get(target.runnerId)
      if (!pricing) {
        continue
      }

      // Node-owned usage: includes sandboxes created by market consumers on this runner.
      const sandboxUsage = await this.providerUsageService.getRunnerUsage(target.runnerId, {
        from: dayLabel,
        to: dayLabel,
      })

      if (sandboxUsage.length === 0) {
        continue
      }

      const existing = await this.settlementRepository.findOne({
        where: {
          runnerId: target.runnerId,
          periodStart: dayLabel,
        },
      })

      if (existing && existing.status !== SettlementStatus.PENDING) {
        continue
      }

      const lines = sandboxUsage.map((usage) => ({
        sandboxId: usage.sandboxId,
        cpuHours: usage.cpuHours,
        memoryGiBHours: usage.memoryGiBHours,
        diskGiBHours: usage.diskGiBHours,
        gpuHours: usage.gpuHours,
        amountCents: computeAmountCents(usage, pricing),
      }))

      const totals = lines.reduce(
        (acc, line) => {
          acc.cpuHours += line.cpuHours
          acc.memoryGiBHours += line.memoryGiBHours
          acc.diskGiBHours += line.diskGiBHours
          acc.gpuHours += line.gpuHours
          acc.amountCents += line.amountCents
          return acc
        },
        { cpuHours: 0, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0, amountCents: 0 },
      )

      const period =
        existing ??
        this.settlementRepository.create({
          organizationId: target.organizationId,
          runnerId: target.runnerId,
          periodStart: dayLabel,
          periodEnd: dayLabel,
        })

      const platformFeeCents = Math.round((totals.amountCents * feeBps) / 10_000)

      period.status = SettlementStatus.PENDING
      period.cpuHours = round(totals.cpuHours)
      period.memoryGiBHours = round(totals.memoryGiBHours)
      period.diskGiBHours = round(totals.diskGiBHours)
      period.gpuHours = round(totals.gpuHours)
      period.amountCents = totals.amountCents
      period.platformFeeCents = platformFeeCents
      period.netCents = totals.amountCents - platformFeeCents
      period.currency = pricing.currency

      const saved = await this.settlementRepository.save(period)

      await this.settlementLineRepository.delete({ settlementPeriodId: saved.id })
      await this.settlementLineRepository.save(
        lines.map((line) =>
          this.settlementLineRepository.create({
            settlementPeriodId: saved.id,
            organizationId: target.organizationId,
            runnerId: target.runnerId,
            periodStart: dayLabel,
            sandboxId: line.sandboxId,
            cpuHours: line.cpuHours,
            memoryGiBHours: line.memoryGiBHours,
            diskGiBHours: line.diskGiBHours,
            gpuHours: line.gpuHours,
            amountCents: line.amountCents,
          }),
        ),
      )

      settled++
    }

    return settled
  }

  async getSettlements(
    organizationId: string,
    query: ProviderSettlementsQueryDto = {},
  ): Promise<ProviderSettlementsResponseDto> {
    const limit = query.limit ?? DEFAULT_LIMIT
    const rangeFrom = query.from ? resolveDateRange(query.from, query.to).fromLabel : undefined
    const rangeTo = query.to ? resolveDateRange(query.from, query.to).toLabel : undefined

    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.runnerId ? { runnerId: query.runnerId } : {}),
      ...(rangeFrom && rangeTo ? { periodStart: Between(rangeFrom, rangeTo) } : {}),
    }

    const settlements = await this.settlementRepository.find({
      where,
      order: {
        periodStart: 'DESC',
        createdAt: 'DESC',
      },
      take: limit,
    })

    const runnerNameMap = await this.resolveRunnerNames(settlements.map((settlement) => settlement.runnerId))

    return {
      items: settlements.map((settlement) => this.toItem(settlement, runnerNameMap.get(settlement.runnerId) ?? '')),
    }
  }

  async getSettlementDetail(organizationId: string, id: string): Promise<ProviderSettlementDetailDto> {
    const settlement = await this.settlementRepository.findOne({
      where: {
        id,
        organizationId,
      },
    })

    if (!settlement) {
      throw new NotFoundException('Settlement not found')
    }

    const [lines, runnerNameMap] = await Promise.all([
      this.settlementLineRepository.find({
        where: {
          settlementPeriodId: settlement.id,
        },
        order: {
          amountCents: 'DESC',
        },
      }),
      this.resolveRunnerNames([settlement.runnerId]),
    ])

    const lineItems: ProviderSettlementLineDto[] = lines.map((line) => ({
      sandboxId: line.sandboxId,
      cpuHours: line.cpuHours,
      memoryGiBHours: line.memoryGiBHours,
      diskGiBHours: line.diskGiBHours,
      gpuHours: line.gpuHours,
      amountCents: line.amountCents,
    }))

    return {
      ...this.toItem(settlement, runnerNameMap.get(settlement.runnerId) ?? ''),
      lines: lineItems,
    }
  }

  /**
   * Provider initiated status change. Only SETTLED -> WITHDRAWING -> WITHDRAWN is allowed;
   * the platform is the only actor that can mark a PENDING settlement as SETTLED.
   */
  async updateStatus(
    organizationId: string,
    id: string,
    dto: UpdateProviderSettlementStatusDto,
  ): Promise<ProviderSettlementItemDto> {
    const settlement = await this.settlementRepository.findOne({
      where: {
        id,
        organizationId,
      },
    })

    if (!settlement) {
      throw new NotFoundException('Settlement not found')
    }

    if (!ALLOWED_STATUS_TRANSITIONS[settlement.status].includes(dto.status)) {
      throw new BadRequestException(`Cannot change settlement status from ${settlement.status} to ${dto.status}`)
    }

    settlement.status = dto.status
    if (dto.status === SettlementStatus.WITHDRAWN) {
      settlement.withdrawnAt = new Date()
    }

    const saved = await this.settlementRepository.save(settlement)
    const runnerNameMap = await this.resolveRunnerNames([saved.runnerId])

    return this.toItem(saved, runnerNameMap.get(saved.runnerId) ?? '')
  }

  /**
   * Platform (system admin) action: recompute the settlements of a UTC day. Useful for
   * backfills and for fixing days priced before pricing was configured. Only PENDING
   * settlements are touched. Returns the number of recomputed settlement rows.
   */
  async recomputeDay(day?: string): Promise<number> {
    const dayLabel = day ?? formatUtcDay(new Date(Date.now() - DAY_MS))
    return this.settleDay(dayLabel)
  }

  /**
   * Platform (system admin) action: mark a PENDING settlement as SETTLED.
   */
  async markSettled(id: string): Promise<void> {
    const settlement = await this.settlementRepository.findOne({
      where: {
        id,
      },
    })

    if (!settlement) {
      throw new NotFoundException('Settlement not found')
    }

    if (settlement.status !== SettlementStatus.PENDING) {
      throw new BadRequestException(`Only PENDING settlements can be settled, current status is ${settlement.status}`)
    }

    settlement.status = SettlementStatus.SETTLED
    settlement.settledAt = new Date()
    await this.settlementRepository.save(settlement)
  }

  private async resolveTargets(organizationId?: string): Promise<SettlementTarget[]> {
    if (organizationId) {
      const runners = await this.runnerService.findAllByOrganization(organizationId)
      return runners.map((runner) => ({ organizationId, runnerId: runner.id, runnerName: runner.name }))
    }

    const regions = await this.regionService.findAllByRegionType(RegionType.CUSTOM)
    const targets: SettlementTarget[] = []

    for (const region of regions) {
      if (!region.organizationId) {
        continue
      }
      const runners = await this.runnerService.findAllByRegion(region.id)
      targets.push(
        ...runners.map((runner) => ({
          organizationId: region.organizationId as string,
          runnerId: runner.id,
          runnerName: runner.name,
        })),
      )
    }

    return targets
  }

  private async resolveRunnerNames(runnerIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = Array.from(new Set(runnerIds.filter(Boolean)))
    if (uniqueIds.length === 0) {
      return new Map()
    }
    const runners = await this.runnerService.findByIds(uniqueIds)
    return new Map(runners.map((runner) => [runner.id, runner.name]))
  }

  private toItem(settlement: SettlementPeriod, runnerName: string): ProviderSettlementItemDto {
    return {
      id: settlement.id,
      runnerId: settlement.runnerId,
      runnerName,
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      status: settlement.status,
      cpuHours: settlement.cpuHours,
      memoryGiBHours: settlement.memoryGiBHours,
      diskGiBHours: settlement.diskGiBHours,
      gpuHours: settlement.gpuHours,
      amountCents: settlement.amountCents,
      platformFeeCents: settlement.platformFeeCents,
      netCents: settlement.netCents,
      currency: settlement.currency,
      settledAt: settlement.settledAt?.toISOString() ?? null,
      withdrawnAt: settlement.withdrawnAt?.toISOString() ?? null,
      createdAt: settlement.createdAt.toISOString(),
    }
  }
}
