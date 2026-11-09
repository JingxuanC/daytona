/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm'
import { Region } from '../../region/entities/region.entity'
import { SandboxUsagePeriodArchive } from '../../usage/entities/sandbox-usage-period-archive.entity'
import { SandboxUsagePeriod } from '../../usage/entities/sandbox-usage-period.entity'
import { MarketLease } from '../entities/market-lease.entity'
import { MarketListing } from '../entities/market-listing.entity'
import { MarketUsageItemDto, MarketUsageQueryDto, MarketUsageResponseDto } from '../dto/market-usage.dto'
import { formatUtcDay, HOUR_MS, resolveDateRange, round } from '../../provider/utils/date-range.util'

interface LeasePricing {
  listingId: string
  listingName: string | null
  currency: string
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
}

interface UsageBucket {
  cpuMs: number
  memoryGiBMillis: number
  diskGiBMillis: number
  gpuMilliHours: number
}

/**
 * Consumer-side view of market spend: aggregates the organization's usage periods
 * on market regions and prices them with the lease price snapshot.
 *
 * M1 is display-only: no balance deduction or invoice is produced here.
 */
@Injectable()
export class MarketUsageService {
  constructor(
    @InjectRepository(MarketLease)
    private readonly leaseRepository: Repository<MarketLease>,
    @InjectRepository(MarketListing)
    private readonly listingRepository: Repository<MarketListing>,
    @InjectRepository(SandboxUsagePeriod)
    private readonly usagePeriodRepository: Repository<SandboxUsagePeriod>,
    @InjectRepository(SandboxUsagePeriodArchive)
    private readonly usagePeriodArchiveRepository: Repository<SandboxUsagePeriodArchive>,
    @InjectRepository(Region)
    private readonly regionRepository: Repository<Region>,
  ) {}

  async getUsage(consumerOrganizationId: string, query: MarketUsageQueryDto): Promise<MarketUsageResponseDto> {
    const range = resolveDateRange(query.from, query.to)

    const leases = await this.leaseRepository.find({
      where: { consumerOrganizationId },
      order: { createdAt: 'DESC' },
    })

    // Most recent lease per listing (active or closed) provides the price snapshot for that region.
    const pricingByRegion = new Map<string, LeasePricing>()
    const listingIds = [...new Set(leases.map((lease) => lease.listingId))]
    const listings = listingIds.length > 0 ? await this.listingRepository.find({ where: { id: In(listingIds) } }) : []
    const listingMap = new Map(listings.map((listing) => [listing.id, listing]))

    for (const lease of leases) {
      const listing = listingMap.get(lease.listingId)
      if (!listing) {
        continue
      }
      if (!pricingByRegion.has(listing.regionId)) {
        pricingByRegion.set(listing.regionId, {
          listingId: listing.id,
          listingName: listing.name,
          currency: lease.currency,
          cpuHourCents: lease.cpuHourCents,
          memoryGiBHourCents: lease.memoryGiBHourCents,
          diskGiBHourCents: lease.diskGiBHourCents,
          gpuHourCents: lease.gpuHourCents,
        })
      }
    }

    const regionIds = [...pricingByRegion.keys()]
    const response: MarketUsageResponseDto = {
      from: range.fromLabel,
      to: range.toLabel,
      currency: 'CNY',
      items: [],
      totals: { cpuHours: 0, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0, amountCents: 0 },
    }
    if (regionIds.length === 0) {
      return response
    }

    const [currentPeriods, archivedPeriods] = await Promise.all([
      this.fetchPeriods(this.usagePeriodRepository, consumerOrganizationId, regionIds, range),
      this.fetchPeriods(this.usagePeriodArchiveRepository, consumerOrganizationId, regionIds, range),
    ])

    const buckets = new Map<string, UsageBucket>()
    const now = Date.now()

    for (const period of [...currentPeriods, ...archivedPeriods]) {
      const startMs = Math.max(period.startAt.getTime(), range.from.getTime())
      const endMs = Math.min((period.endAt ?? new Date(now)).getTime(), range.to.getTime())
      if (endMs <= startMs) {
        continue
      }
      const key = `${formatUtcDay(period.startAt)}|${period.region}`
      const bucket = buckets.get(key) ?? { cpuMs: 0, memoryGiBMillis: 0, diskGiBMillis: 0, gpuMilliHours: 0 }
      const durationMs = endMs - startMs
      bucket.cpuMs += period.cpu * durationMs
      bucket.memoryGiBMillis += period.mem * durationMs
      bucket.diskGiBMillis += period.disk * durationMs
      bucket.gpuMilliHours += (period.gpu ?? 0) * durationMs
      buckets.set(key, bucket)
    }

    const regionNameMap = await this.resolveRegionNames(regionIds)
    let currency = 'CNY'

    for (const [key, bucket] of buckets) {
      const [date, regionId] = key.split('|')
      const pricing = pricingByRegion.get(regionId)
      if (!pricing) {
        continue
      }
      currency = pricing.currency
      const cpuHours = bucket.cpuMs / HOUR_MS
      const memoryGiBHours = bucket.memoryGiBMillis / HOUR_MS
      const diskGiBHours = bucket.diskGiBMillis / HOUR_MS
      const gpuHours = bucket.gpuMilliHours / HOUR_MS
      const amountCents = Math.round(
        cpuHours * pricing.cpuHourCents +
          memoryGiBHours * pricing.memoryGiBHourCents +
          diskGiBHours * pricing.diskGiBHourCents +
          gpuHours * pricing.gpuHourCents,
      )

      const item: MarketUsageItemDto = {
        date,
        listingId: pricing.listingId,
        listingName: pricing.listingName,
        regionId,
        regionName: regionNameMap.get(regionId) ?? null,
        cpuHours: round(cpuHours),
        memoryGiBHours: round(memoryGiBHours),
        diskGiBHours: round(diskGiBHours),
        gpuHours: round(gpuHours),
        amountCents,
        currency: pricing.currency,
      }
      response.items.push(item)
      response.totals.cpuHours += item.cpuHours
      response.totals.memoryGiBHours += item.memoryGiBHours
      response.totals.diskGiBHours += item.diskGiBHours
      response.totals.gpuHours += item.gpuHours
      response.totals.amountCents += amountCents
    }

    response.currency = currency
    response.items.sort((a, b) => `${a.date}|${a.regionId}`.localeCompare(`${b.date}|${b.regionId}`))
    response.totals = {
      cpuHours: round(response.totals.cpuHours),
      memoryGiBHours: round(response.totals.memoryGiBHours),
      diskGiBHours: round(response.totals.diskGiBHours),
      gpuHours: round(response.totals.gpuHours),
      amountCents: response.totals.amountCents,
    }
    return response
  }

  private async fetchPeriods<T extends SandboxUsagePeriod | SandboxUsagePeriodArchive>(
    repository: Pick<Repository<T>, 'find'>,
    organizationId: string,
    regionIds: string[],
    range: { from: Date; to: Date },
  ): Promise<T[]> {
    const baseWhere = {
      organizationId,
      region: In(regionIds),
      startAt: LessThan(range.to),
    } as Record<string, unknown>

    const [openPeriods, closedPeriods] = await Promise.all([
      repository.find({ where: { ...baseWhere, endAt: IsNull() } as never }),
      repository.find({ where: { ...baseWhere, endAt: MoreThan(range.from) } as never }),
    ])
    return [...openPeriods, ...closedPeriods]
  }

  private async resolveRegionNames(regionIds: string[]): Promise<Map<string, string>> {
    if (regionIds.length === 0) {
      return new Map()
    }
    const regions = await this.regionRepository.find({ where: { id: In(regionIds) } })
    return new Map(regions.map((region) => [region.id, region.name]))
  }
}
