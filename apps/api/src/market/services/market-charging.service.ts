/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Between, DataSource, In, IsNull, LessThan, MoreThan, Repository } from 'typeorm'
import { MarketCreditEntryType } from '../enums/market-credit-entry-type.enum'
import { MarketCreditService } from './market-credit.service'
import { MarketLease } from '../entities/market-lease.entity'
import { MarketListing } from '../entities/market-listing.entity'
import { MarketUsageCharge } from '../entities/market-usage-charge.entity'
import { SandboxUsagePeriod } from '../../usage/entities/sandbox-usage-period.entity'
import { SandboxUsagePeriodArchive } from '../../usage/entities/sandbox-usage-period-archive.entity'
import { DAY_MS, formatUtcDay, HOUR_MS, resolveDateRange, round } from '../../provider/utils/date-range.util'
import { platformFeeBpsFromEnv } from '../../common/utils/platform-fee'

interface LeaseDayUsage {
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
}

/**
 * M2 billing: turns consumer market usage into credit-ledger charges.
 *
 * The job charges one UTC day at a time (idempotent per lease/day). Provider
 * settlement stays the source of truth for provider revenue; the platform
 * commission is recorded on the settlement (see ProviderSettlementService).
 */
@Injectable()
export class MarketChargingService {
  private readonly logger = new Logger(MarketChargingService.name)

  constructor(
    @InjectRepository(MarketLease)
    private readonly leaseRepository: Repository<MarketLease>,
    @InjectRepository(MarketListing)
    private readonly listingRepository: Repository<MarketListing>,
    @InjectRepository(MarketUsageCharge)
    private readonly chargeRepository: Repository<MarketUsageCharge>,
    @InjectRepository(SandboxUsagePeriod)
    private readonly usagePeriodRepository: Repository<SandboxUsagePeriod>,
    @InjectRepository(SandboxUsagePeriodArchive)
    private readonly usagePeriodArchiveRepository: Repository<SandboxUsagePeriodArchive>,
    private readonly creditService: MarketCreditService,
    private readonly dataSource: DataSource,
  ) {}

  /** Charges the previous UTC day shortly after provider settlement (01:00 UTC). */
  @Cron('0 30 1 * * *', { name: 'market-daily-usage-charging' })
  async chargePreviousDay(): Promise<void> {
    try {
      const charged = await this.recomputeDay()
      if (charged > 0) {
        this.logger.log(`Charged ${charged} market lease(s) for the previous UTC day`)
      }
    } catch (error) {
      this.logger.error('Failed to charge market usage', error)
    }
  }

  async recomputeDay(day?: string): Promise<number> {
    const dayLabel = day?.slice(0, 10) ?? this.previousDayLabel()
    const range = resolveDateRange(dayLabel, dayLabel, 1)
    const feeBps = platformFeeBpsFromEnv()

    const leases = await this.leaseRepository.find({
      where: [{ status: 'active' as MarketLease['status'] }, { closedAt: MoreThan(range.from) }],
    })
    if (leases.length === 0) {
      return 0
    }

    const listingIds = [...new Set(leases.map((lease) => lease.listingId))]
    const listings = await this.listingRepository.find({ where: { id: In(listingIds) } })
    const listingMap = new Map(listings.map((listing) => [listing.id, listing]))

    let charged = 0
    for (const lease of leases) {
      const listing = listingMap.get(lease.listingId)
      if (!listing) {
        continue
      }

      const existing = await this.chargeRepository.findOne({
        where: { leaseId: lease.id, periodStart: dayLabel },
      })
      if (existing) {
        continue
      }

      const usage = await this.computeLeaseUsage(lease, listing, range.from, range.to)
      const amountCents = Math.round(
        usage.cpuHours * lease.cpuHourCents +
          usage.memoryGiBHours * lease.memoryGiBHourCents +
          usage.diskGiBHours * lease.diskGiBHourCents +
          usage.gpuHours * lease.gpuHourCents,
      )
      if (amountCents <= 0) {
        continue
      }

      const platformFeeCents = Math.round((amountCents * feeBps) / 10_000)
      const providerNetCents = amountCents - platformFeeCents

      await this.dataSource.transaction(async (manager) => {
        const chargeRepository = manager.getRepository(MarketUsageCharge)
        const charge = chargeRepository.create({
          leaseId: lease.id,
          listingId: listing.id,
          consumerOrganizationId: lease.consumerOrganizationId,
          providerOrganizationId: listing.providerOrganizationId,
          periodStart: dayLabel,
          cpuHours: round(usage.cpuHours),
          memoryGiBHours: round(usage.memoryGiBHours),
          diskGiBHours: round(usage.diskGiBHours),
          gpuHours: round(usage.gpuHours),
          amountCents,
          platformFeeCents,
          providerNetCents,
          currency: lease.currency,
        })
        const saved = await chargeRepository.save(charge)

        await this.creditService.appendWithinManager(manager, {
          organizationId: lease.consumerOrganizationId,
          type: MarketCreditEntryType.CHARGE,
          signedAmountCents: -amountCents,
          description: `Market usage ${dayLabel} on ${listing.name}`,
          referenceType: 'market_usage',
          referenceId: saved.id,
        })
      })
      charged++
    }

    return charged
  }

  async listCharges(
    consumerOrganizationId: string,
    options: { from?: string; to?: string } = {},
  ): Promise<{ items: MarketUsageCharge[]; listingNames: Map<string, string> }> {
    const range = resolveDateRange(options.from, options.to)
    const items = await this.chargeRepository.find({
      where: {
        consumerOrganizationId,
        periodStart: Between(range.fromLabel, range.toLabel),
      },
      order: { periodStart: 'DESC' },
    })

    const listingIds = [...new Set(items.map((item) => item.listingId))]
    const listingNames = new Map<string, string>()
    if (listingIds.length > 0) {
      const listings = await this.listingRepository.find({ where: { id: In(listingIds) } })
      for (const listing of listings) {
        listingNames.set(listing.id, listing.name)
      }
    }

    return { items, listingNames }
  }

  /** Operations overview for the platform admin (M3). */
  async getOverview(): Promise<{
    listings: Record<string, number>
    activeLeases: number
    charges: { count: number; amountCents: number; platformFeeCents: number }
    negativeBalanceOrganizations: Array<{ organizationId: string; balanceCents: number }>
  }> {
    const [listingRows, activeLeases, chargeRow, negativeBalanceOrganizations] = await Promise.all([
      this.listingRepository
        .createQueryBuilder('listing')
        .select('listing.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('listing.status')
        .getRawMany<{ status: string; count: string }>(),
      this.leaseRepository.count({ where: { status: 'active' as MarketLease['status'] } }),
      this.chargeRepository
        .createQueryBuilder('charge')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(charge.amountCents), 0)', 'amount')
        .addSelect('COALESCE(SUM(charge.platformFeeCents), 0)', 'fee')
        .getRawOne<{ count: string; amount: string; fee: string }>(),
      this.creditService.getNegativeBalances(),
    ])

    const listings: Record<string, number> = {}
    for (const row of listingRows) {
      listings[row.status] = Number(row.count)
    }

    return {
      listings,
      activeLeases,
      charges: {
        count: Number(chargeRow?.count ?? 0),
        amountCents: Number(chargeRow?.amount ?? 0),
        platformFeeCents: Number(chargeRow?.fee ?? 0),
      },
      negativeBalanceOrganizations,
    }
  }

  private previousDayLabel(): string {
    return formatUtcDay(new Date(Date.now() - DAY_MS))
  }

  private async computeLeaseUsage(
    lease: MarketLease,
    listing: MarketListing,
    from: Date,
    to: Date,
  ): Promise<LeaseDayUsage> {
    const [current, archived] = await Promise.all([
      this.fetchPeriods(this.usagePeriodRepository, lease.consumerOrganizationId, listing.regionId, from, to),
      this.fetchPeriods(this.usagePeriodArchiveRepository, lease.consumerOrganizationId, listing.regionId, from, to),
    ])

    const now = Date.now()
    const usage: LeaseDayUsage = { cpuHours: 0, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0 }
    for (const period of [...current, ...archived]) {
      const startMs = Math.max(period.startAt.getTime(), from.getTime())
      const endMs = Math.min((period.endAt ?? new Date(now)).getTime(), to.getTime())
      if (endMs <= startMs) {
        continue
      }
      const hours = (endMs - startMs) / HOUR_MS
      usage.cpuHours += period.cpu * hours
      usage.memoryGiBHours += period.mem * hours
      usage.diskGiBHours += period.disk * hours
      usage.gpuHours += (period.gpu ?? 0) * hours
    }
    return usage
  }

  private async fetchPeriods<T extends SandboxUsagePeriod | SandboxUsagePeriodArchive>(
    repository: Pick<Repository<T>, 'find'>,
    organizationId: string,
    regionId: string,
    from: Date,
    to: Date,
  ): Promise<T[]> {
    const base = { organizationId, region: regionId, startAt: LessThan(to) }
    const [openPeriods, closedPeriods] = await Promise.all([
      repository.find({ where: { ...base, endAt: IsNull() } as never }),
      repository.find({ where: { ...base, endAt: MoreThan(from) } as never }),
    ])
    return [...openPeriods, ...closedPeriods]
  }
}
