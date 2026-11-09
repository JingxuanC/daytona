/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Between, Repository } from 'typeorm'
import {
  ProviderEarningsItemDto,
  ProviderEarningsQueryDto,
  ProviderEarningsResponseDto,
  ProviderEarningsTotalsDto,
} from '../dto/provider-earnings.dto'
import { SettlementPeriod } from '../entities/settlement-period.entity'
import { resolveDateRange, round } from '../utils/date-range.util'
import { computeAmountCents } from '../utils/pricing.util'
import { DEFAULT_PROVIDER_CURRENCY } from './provider-usage.service'
import { ProviderPricingService } from './provider-pricing.service'
import { ProviderUsageService } from './provider-usage.service'

@Injectable()
export class ProviderEarningsService {
  constructor(
    @InjectRepository(SettlementPeriod)
    private readonly settlementRepository: Repository<SettlementPeriod>,
    private readonly providerUsageService: ProviderUsageService,
    private readonly providerPricingService: ProviderPricingService,
  ) {}

  /**
   * Returns the provider revenue per node per day. Days that have already been settled are
   * read from the settlement table (authoritative); unsettled days are priced in real time
   * from the usage data so the console can show today's in-flight earnings.
   */
  async getEarnings(organizationId: string, query: ProviderEarningsQueryDto = {}): Promise<ProviderEarningsResponseDto> {
    const range = resolveDateRange(query.from, query.to)

    const [usage, pricingMap, storedSettlements] = await Promise.all([
      this.providerUsageService.getUsage(organizationId, {
        from: range.fromLabel,
        to: range.toLabel,
        granularity: 'day',
        runnerId: query.runnerId,
      }),
      this.providerPricingService.getPricingMap(organizationId),
      this.settlementRepository.find({
        where: {
          organizationId,
          periodStart: Between(range.fromLabel, range.toLabel),
          ...(query.runnerId ? { runnerId: query.runnerId } : {}),
        },
      }),
    ])

    const storedMap = new Map(storedSettlements.map((settlement) => [`${settlement.periodStart}|${settlement.runnerId}`, settlement]))

    const items: ProviderEarningsItemDto[] = usage.items.map((item) => {
      const stored = item.runnerId ? storedMap.get(`${item.date}|${item.runnerId}`) : undefined
      const pricing = item.runnerId ? pricingMap.get(item.runnerId) : undefined

      return {
        date: item.date ?? range.fromLabel,
        runnerId: item.runnerId,
        runnerName: item.runnerName,
        cpuHours: item.cpuHours,
        memoryGiBHours: item.memoryGiBHours,
        diskGiBHours: item.diskGiBHours,
        gpuHours: item.gpuHours,
        amountCents: stored?.amountCents ?? computeAmountCents(item, pricing),
        settlementStatus: stored?.status ?? null,
        settlementId: stored?.id ?? null,
      }
    })

    const totals = items.reduce<ProviderEarningsTotalsDto>(
      (acc, item) => {
        acc.cpuHours += item.cpuHours
        acc.memoryGiBHours += item.memoryGiBHours
        acc.diskGiBHours += item.diskGiBHours
        acc.gpuHours += item.gpuHours
        acc.amountCents += item.amountCents
        return acc
      },
      {
        cpuHours: 0,
        memoryGiBHours: 0,
        diskGiBHours: 0,
        gpuHours: 0,
        amountCents: 0,
      },
    )

    totals.cpuHours = round(totals.cpuHours)
    totals.memoryGiBHours = round(totals.memoryGiBHours)
    totals.diskGiBHours = round(totals.diskGiBHours)
    totals.gpuHours = round(totals.gpuHours)

    return {
      from: range.fromLabel,
      to: range.toLabel,
      currency: DEFAULT_PROVIDER_CURRENCY,
      items,
      totals,
    }
  }
}
