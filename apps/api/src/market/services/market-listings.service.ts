/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { TypedConfigService } from '../../config/typed-config.service'
import { OrganizationService } from '../../organization/services/organization.service'
import { Region } from '../../region/entities/region.entity'
import { RegionService } from '../../region/services/region.service'
import { RunnerState } from '../../sandbox/enums/runner-state.enum'
import { Runner } from '../../sandbox/entities/runner.entity'
import { RunnerPricing } from '../../provider/entities/runner-pricing.entity'
import { RunnerAlert } from '../../provider/entities/runner-alert.entity'
import { RunnerDailyMetric } from '../../provider/entities/runner-daily-metric.entity'
import { DAY_MS, formatUtcDay } from '../../provider/utils/date-range.util'
import { MarketListing } from '../entities/market-listing.entity'
import { MarketLease } from '../entities/market-lease.entity'
import { MarketLeaseStatus } from '../enums/market-lease-status.enum'
import { MarketListingStatus, MarketListingVisibility } from '../enums/market-listing-status.enum'
import {
  CreateMarketListingDto,
  MarketListingDto,
  MarketListingSort,
  MarketReputationDto,
  UpdateMarketListingDto,
} from '../dto/market-listing.dto'

@Injectable()
export class MarketListingsService {
  private readonly logger = new Logger(MarketListingsService.name)

  constructor(
    @InjectRepository(MarketListing)
    private readonly listingRepository: Repository<MarketListing>,
    @InjectRepository(MarketLease)
    private readonly leaseRepository: Repository<MarketLease>,
    @InjectRepository(Region)
    private readonly regionRepository: Repository<Region>,
    @InjectRepository(Runner)
    private readonly runnerRepository: Repository<Runner>,
    @InjectRepository(RunnerPricing)
    private readonly pricingRepository: Repository<RunnerPricing>,
    @InjectRepository(RunnerDailyMetric)
    private readonly dailyMetricRepository: Repository<RunnerDailyMetric>,
    @InjectRepository(RunnerAlert)
    private readonly alertRepository: Repository<RunnerAlert>,
    private readonly regionService: RegionService,
    private readonly organizationService: OrganizationService,
    private readonly configService: TypedConfigService,
  ) {}

  async listPublic(
    consumerOrganizationId?: string,
    options: { sort?: MarketListingSort } = {},
  ): Promise<MarketListingDto[]> {
    const listings = await this.listingRepository.find({
      where: { status: MarketListingStatus.PUBLISHED, visibility: MarketListingVisibility.PUBLIC },
      order: { createdAt: 'DESC' },
    })
    if (consumerOrganizationId) {
      // Private listings are only visible to the provider itself (self-lease use cases).
      const own = await this.listingRepository.find({
        where: { providerOrganizationId: consumerOrganizationId },
      })
      for (const listing of own) {
        if (!listings.some((item) => item.id === listing.id)) {
          listings.push(listing)
        }
      }
    }
    return this.sortDtos(await this.toDtos(listings), options.sort)
  }

  private sortDtos(dtos: MarketListingDto[], sort: MarketListingSort = 'newest'): MarketListingDto[] {
    const hourlyPrice = (listing: MarketListingDto) =>
      listing.cpuHourCents + listing.memoryGiBHourCents + listing.diskGiBHourCents
    const successRate = (listing: MarketListingDto) => listing.reputation?.startupSuccessRatePct ?? -1

    switch (sort) {
      case 'price_asc':
        return [...dtos].sort((a, b) => hourlyPrice(a) - hourlyPrice(b))
      case 'price_desc':
        return [...dtos].sort((a, b) => hourlyPrice(b) - hourlyPrice(a))
      case 'capacity_desc':
        return [...dtos].sort((a, b) => b.totalCpu - a.totalCpu)
      case 'reputation_desc':
        return [...dtos].sort(
          (a, b) =>
            (b.reputation?.availabilityScore ?? 0) - (a.reputation?.availabilityScore ?? 0) ||
            successRate(b) - successRate(a),
        )
      case 'success_rate_desc':
        return [...dtos].sort((a, b) => successRate(b) - successRate(a))
      default:
        return [...dtos].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
  }

  async listForProvider(organizationId: string): Promise<MarketListingDto[]> {
    const listings = await this.listingRepository.find({
      where: { providerOrganizationId: organizationId },
      order: { createdAt: 'DESC' },
    })
    return this.toDtos(listings)
  }

  async publish(organizationId: string, dto: CreateMarketListingDto): Promise<MarketListingDto> {
    const region = await this.regionService.findOne(dto.regionId)
    if (!region || region.organizationId !== organizationId) {
      throw new NotFoundException('Region not found')
    }

    const hasSchedulableRunner = await this.runnerRepository.exists({
      where: { region: region.id, state: RunnerState.READY },
    })
    if (!hasSchedulableRunner) {
      throw new BadRequestException('Region has no ready compute node to sell')
    }

    const capacity = this.resolveCapacity(dto)
    this.assertCapacity(capacity, dto)

    let listing = await this.listingRepository.findOne({
      where: { providerOrganizationId: organizationId, regionId: region.id },
    })

    const requireApproval = process.env.MARKET_REQUIRE_PROVIDER_APPROVAL === 'true'
    const desiredStatus = dto.status ?? MarketListingStatus.PUBLISHED
    const status =
      desiredStatus === MarketListingStatus.PUBLISHED && requireApproval
        ? MarketListingStatus.PENDING_APPROVAL
        : desiredStatus

    const fields: Partial<MarketListing> = {
      providerOrganizationId: organizationId,
      regionId: region.id,
      name: dto.name,
      description: dto.description ?? null,
      currency: dto.currency ?? 'CNY',
      cpuHourCents: dto.cpuHourCents,
      memoryGiBHourCents: dto.memoryGiBHourCents,
      diskGiBHourCents: dto.diskGiBHourCents,
      gpuHourCents: dto.gpuHourCents ?? 0,
      ...capacity,
      maxSandboxes: dto.maxSandboxes ?? 10,
      ...(dto.slaAvailabilityPct !== undefined ? { slaAvailabilityPct: dto.slaAvailabilityPct } : {}),
      ...(dto.slaCompensationBps !== undefined ? { slaCompensationBps: dto.slaCompensationBps } : {}),
      visibility: MarketListingVisibility.PUBLIC,
      status,
    }

    if (listing) {
      Object.assign(listing, fields)
    } else {
      listing = new MarketListing(fields)
    }
    listing = await this.listingRepository.save(listing)

    await this.prepareRegionForMarket(organizationId, region.id, capacity)
    await this.syncRunnerPricing(organizationId, region.id, listing)

    return this.toDto(listing)
  }

  async update(organizationId: string, listingId: string, dto: UpdateMarketListingDto): Promise<MarketListingDto> {
    const listing = await this.getOwnedListingOrFail(organizationId, listingId)

    const capacity = {
      totalCpu: dto.totalCpu ?? listing.totalCpu,
      totalMemoryGiB: dto.totalMemoryGiB ?? listing.totalMemoryGiB,
      totalDiskGiB: dto.totalDiskGiB ?? listing.totalDiskGiB,
      maxCpuPerSandbox: dto.maxCpuPerSandbox ?? listing.maxCpuPerSandbox,
      maxMemoryPerSandbox: dto.maxMemoryPerSandbox ?? listing.maxMemoryPerSandbox,
      maxDiskPerSandbox: dto.maxDiskPerSandbox ?? listing.maxDiskPerSandbox,
    }
    this.assertCapacity(capacity, { ...capacity, name: listing.name } as CreateMarketListingDto)

    Object.assign(listing, {
      name: dto.name ?? listing.name,
      description: dto.description ?? listing.description,
      ...(dto.cpuHourCents !== undefined ? { cpuHourCents: dto.cpuHourCents } : {}),
      ...(dto.memoryGiBHourCents !== undefined ? { memoryGiBHourCents: dto.memoryGiBHourCents } : {}),
      ...(dto.diskGiBHourCents !== undefined ? { diskGiBHourCents: dto.diskGiBHourCents } : {}),
      ...(dto.gpuHourCents !== undefined ? { gpuHourCents: dto.gpuHourCents } : {}),
      ...capacity,
      ...(dto.maxSandboxes !== undefined ? { maxSandboxes: dto.maxSandboxes } : {}),
      ...(dto.slaAvailabilityPct !== undefined ? { slaAvailabilityPct: dto.slaAvailabilityPct } : {}),
      ...(dto.slaCompensationBps !== undefined ? { slaCompensationBps: dto.slaCompensationBps } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    })
    const saved = await this.listingRepository.save(listing)

    if (saved.status === MarketListingStatus.PUBLISHED) {
      await this.prepareRegionForMarket(organizationId, saved.regionId, capacity)
      await this.syncRunnerPricing(organizationId, saved.regionId, saved)
    }

    return this.toDto(saved)
  }

  async retire(organizationId: string, listingId: string): Promise<MarketListingDto> {
    const listing = await this.getOwnedListingOrFail(organizationId, listingId)
    listing.status = MarketListingStatus.RETIRED
    const saved = await this.listingRepository.save(listing)
    return this.toDto(saved)
  }

  async getOwnedListingOrFail(organizationId: string, listingId: string): Promise<MarketListing> {
    const listing = await this.listingRepository.findOne({ where: { id: listingId } })
    if (!listing || listing.providerOrganizationId !== organizationId) {
      throw new NotFoundException('Listing not found')
    }
    return listing
  }

  /**
   * Enables quota enforcement on the provider region and guarantees the provider
   * itself still has a quota big enough to keep running its own sandboxes.
   */
  private async prepareRegionForMarket(
    organizationId: string,
    regionId: string,
    capacity: {
      totalCpu: number
      totalMemoryGiB: number
      totalDiskGiB: number
      maxCpuPerSandbox: number
      maxMemoryPerSandbox: number
      maxDiskPerSandbox: number
    },
  ): Promise<void> {
    const region = await this.regionService.findOne(regionId)
    if (!region) {
      throw new NotFoundException('Region not found')
    }

    if (!region.enforceQuotas) {
      await this.regionRepository.update({ id: regionId }, { enforceQuotas: true })
    }

    const sandboxClass = this.configService.getOrThrow('defaultSandboxClass')
    const existing = await this.organizationService.getRegionQuota(organizationId, regionId, sandboxClass)

    if (!existing) {
      await this.organizationService.createRegionQuota(organizationId, regionId, {
        sandboxClass,
        totalCpuQuota: capacity.totalCpu,
        totalMemoryQuota: capacity.totalMemoryGiB,
        totalDiskQuota: capacity.totalDiskGiB,
        totalGpuQuota: 0,
        maxCpuPerSandbox: capacity.maxCpuPerSandbox,
        maxMemoryPerSandbox: capacity.maxMemoryPerSandbox,
        maxDiskPerSandbox: capacity.maxDiskPerSandbox,
      })
      return
    }

    if (
      existing.totalCpuQuota < capacity.totalCpu ||
      existing.totalMemoryQuota < capacity.totalMemoryGiB ||
      existing.totalDiskQuota < capacity.totalDiskGiB
    ) {
      await this.organizationService.updateRegionQuota(organizationId, regionId, {
        sandboxClass,
        totalCpuQuota: Math.max(existing.totalCpuQuota, capacity.totalCpu),
        totalMemoryQuota: Math.max(existing.totalMemoryQuota, capacity.totalMemoryGiB),
        totalDiskQuota: Math.max(existing.totalDiskQuota, capacity.totalDiskGiB),
        totalGpuQuota: existing.totalGpuQuota,
        maxCpuPerSandbox: Math.max(existing.maxCpuPerSandbox ?? 0, capacity.maxCpuPerSandbox),
        maxMemoryPerSandbox: Math.max(existing.maxMemoryPerSandbox ?? 0, capacity.maxMemoryPerSandbox),
        maxDiskPerSandbox: Math.max(existing.maxDiskPerSandbox ?? 0, capacity.maxDiskPerSandbox),
      })
    }
  }

  private async syncRunnerPricing(organizationId: string, regionId: string, listing: MarketListing): Promise<void> {
    const runners = await this.runnerRepository.find({ where: { region: regionId } })
    for (const runner of runners) {
      let pricing = await this.pricingRepository.findOne({ where: { runnerId: runner.id } })
      if (!pricing) {
        pricing = new RunnerPricing()
        pricing.runnerId = runner.id
      }
      pricing.organizationId = organizationId
      pricing.cpuHourCents = listing.cpuHourCents
      pricing.memoryGiBHourCents = listing.memoryGiBHourCents
      pricing.diskGiBHourCents = listing.diskGiBHourCents
      pricing.gpuHourCents = listing.gpuHourCents
      pricing.currency = listing.currency
      await this.pricingRepository.save(pricing)
    }
  }

  private resolveCapacity(dto: CreateMarketListingDto): {
    totalCpu: number
    totalMemoryGiB: number
    totalDiskGiB: number
    maxCpuPerSandbox: number
    maxMemoryPerSandbox: number
    maxDiskPerSandbox: number
  } {
    return {
      totalCpu: dto.totalCpu,
      totalMemoryGiB: dto.totalMemoryGiB,
      totalDiskGiB: dto.totalDiskGiB,
      maxCpuPerSandbox: dto.maxCpuPerSandbox ?? Math.min(dto.totalCpu, 8),
      maxMemoryPerSandbox: dto.maxMemoryPerSandbox ?? Math.min(dto.totalMemoryGiB, 16),
      maxDiskPerSandbox: dto.maxDiskPerSandbox ?? Math.min(dto.totalDiskGiB, 100),
    }
  }

  private assertCapacity(
    capacity: {
      totalCpu: number
      totalMemoryGiB: number
      totalDiskGiB: number
      maxCpuPerSandbox: number
      maxMemoryPerSandbox: number
      maxDiskPerSandbox: number
    },
    _dto: CreateMarketListingDto,
  ): void {
    const { totalCpu, totalMemoryGiB, totalDiskGiB, maxCpuPerSandbox, maxMemoryPerSandbox, maxDiskPerSandbox } =
      capacity
    if (totalCpu < 1 || totalMemoryGiB < 1 || totalDiskGiB < 1) {
      throw new BadRequestException('Listing capacity must be positive')
    }
    if (maxCpuPerSandbox > totalCpu || maxMemoryPerSandbox > totalMemoryGiB || maxDiskPerSandbox > totalDiskGiB) {
      throw new BadRequestException('Per-sandbox limits cannot exceed the leased capacity')
    }
  }

  private async toDtos(listings: MarketListing[]): Promise<MarketListingDto[]> {
    if (listings.length === 0) {
      return []
    }
    const regionNames = await this.resolveRegionNames(listings.map((listing) => listing.regionId))
    const leaseCounts = await this.resolveActiveLeaseCounts(listings.map((listing) => listing.id))
    const reputations = await this.computeRegionReputations([...new Set(listings.map((listing) => listing.regionId))])
    return listings.map((listing) =>
      MarketListingDto.fromEntity(listing, {
        regionName: regionNames.get(listing.regionId) ?? null,
        activeLeaseCount: leaseCounts.get(listing.id) ?? 0,
        reputation: reputations.get(listing.regionId) ?? null,
      }),
    )
  }

  private async toDto(listing: MarketListing): Promise<MarketListingDto> {
    const [dto] = await this.toDtos([listing])
    return dto
  }

  /**
   * Reputation of a listing region, aggregated from its runners' availability scores,
   * the last 7 days of sandbox start metrics and open node alerts.
   */
  private async computeRegionReputations(regionIds: string[]): Promise<Map<string, MarketReputationDto>> {
    const result = new Map<string, MarketReputationDto>()
    if (regionIds.length === 0) {
      return result
    }

    const runners = await this.runnerRepository.find({ where: { region: In(regionIds) } })
    if (runners.length === 0) {
      return result
    }
    const runnerIds = runners.map((runner) => runner.id)
    const fromDate = formatUtcDay(new Date(Date.now() - 7 * DAY_MS))

    const [metricRows, alertRows] = await Promise.all([
      this.dailyMetricRepository
        .createQueryBuilder('metric')
        .select('metric."runnerId"', 'runnerId')
        .addSelect('COALESCE(SUM(metric."sandboxStarts"), 0)', 'starts')
        .addSelect('COALESCE(SUM(metric."sandboxStartFailures"), 0)', 'failures')
        .addSelect('COALESCE(SUM(metric."totalStartupSeconds"), 0)', 'startupSeconds')
        .where('metric."runnerId" IN (:...runnerIds)', { runnerIds })
        .andWhere('metric."date" >= :fromDate', { fromDate })
        .groupBy('metric."runnerId"')
        .getRawMany<{ runnerId: string; starts: string; failures: string; startupSeconds: string }>(),
      this.alertRepository
        .createQueryBuilder('alert')
        .select('alert."runnerId"', 'runnerId')
        .addSelect('COUNT(*)', 'count')
        .where('alert."runnerId" IN (:...runnerIds)', { runnerIds })
        .andWhere('alert."resolvedAt" IS NULL')
        .groupBy('alert."runnerId"')
        .getRawMany<{ runnerId: string; count: string }>(),
    ])

    const metricsByRunner = new Map(
      metricRows.map((row) => [
        row.runnerId,
        {
          starts: Number(row.starts),
          failures: Number(row.failures),
          startupSeconds: Number(row.startupSeconds),
        },
      ]),
    )
    const alertsByRunner = new Map(alertRows.map((row) => [row.runnerId, Number(row.count)]))

    for (const regionId of regionIds) {
      const regionRunners = runners.filter((runner) => runner.region === regionId)
      let starts = 0
      let failures = 0
      let startupSeconds = 0
      let availabilitySum = 0
      let openAlertCount = 0

      for (const runner of regionRunners) {
        availabilitySum += runner.availabilityScore ?? 0
        openAlertCount += alertsByRunner.get(runner.id) ?? 0
        const metrics = metricsByRunner.get(runner.id)
        if (metrics) {
          starts += metrics.starts
          failures += metrics.failures
          startupSeconds += metrics.startupSeconds
        }
      }

      const completed = Math.max(starts - failures, 0)
      result.set(regionId, {
        availabilityScore: Math.round((availabilitySum / Math.max(regionRunners.length, 1)) * 10) / 10,
        startupSuccessRatePct: starts > 0 ? Math.round((completed / starts) * 1000) / 10 : null,
        avgStartupSeconds: completed > 0 ? Math.round((startupSeconds / completed) * 100) / 100 : null,
        sandboxStarts7d: starts,
        sandboxStartFailures7d: failures,
        openAlertCount,
      })
    }

    return result
  }

  private async resolveRegionNames(regionIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(regionIds)]
    if (unique.length === 0) {
      return new Map()
    }
    const regions = await this.regionService.findByIds(unique)
    return new Map(regions.map((region) => [region.id, region.name]))
  }

  private async resolveActiveLeaseCounts(listingIds: string[]): Promise<Map<string, number>> {
    if (listingIds.length === 0) {
      return new Map()
    }
    const rows = await this.leaseRepository
      .createQueryBuilder('lease')
      .select('lease."listingId"', 'listingId')
      .addSelect('COUNT(*)', 'count')
      .where('lease."listingId" IN (:...listingIds)', { listingIds })
      .andWhere('lease."status" = :status', { status: MarketLeaseStatus.ACTIVE })
      .groupBy('lease."listingId"')
      .getRawMany<{ listingId: string; count: string }>()
    return new Map(rows.map((row) => [row.listingId, Number(row.count)]))
  }
}
