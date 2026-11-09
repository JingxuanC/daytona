/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { TypedConfigService } from '../../config/typed-config.service'
import { OrganizationService } from '../../organization/services/organization.service'
import { Region } from '../../region/entities/region.entity'
import { RegionService } from '../../region/services/region.service'
import { MarketLease } from '../entities/market-lease.entity'
import { MarketCreditService } from './market-credit.service'
import { MarketListing } from '../entities/market-listing.entity'
import { MarketLeaseStatus } from '../enums/market-lease-status.enum'
import { MarketListingStatus } from '../enums/market-listing-status.enum'
import { CreateMarketLeaseDto, MarketLeaseDto } from '../dto/market-lease.dto'

@Injectable()
export class MarketLeasesService {
  private readonly logger = new Logger(MarketLeasesService.name)

  constructor(
    @InjectRepository(MarketLease)
    private readonly leaseRepository: Repository<MarketLease>,
    @InjectRepository(MarketListing)
    private readonly listingRepository: Repository<MarketListing>,
    @InjectRepository(Region)
    private readonly regionRepository: Repository<Region>,
    private readonly organizationService: OrganizationService,
    private readonly regionService: RegionService,
    private readonly configService: TypedConfigService,
    private readonly creditService: MarketCreditService,
  ) {}

  async listForConsumer(consumerOrganizationId: string): Promise<MarketLeaseDto[]> {
    const leases = await this.leaseRepository.find({
      where: { consumerOrganizationId },
      order: { createdAt: 'DESC' },
    })
    return this.toDtos(leases)
  }

  /**
   * Returns the active lease (and its listing) the organization holds on a region, if any.
   * Used to enforce market balance before creating sandboxes on someone else's region.
   */
  async findActiveLeaseForRegion(
    consumerOrganizationId: string,
    regionId: string,
  ): Promise<{ lease: MarketLease; listing: MarketListing } | null> {
    const leases = await this.leaseRepository.find({
      where: { consumerOrganizationId, status: MarketLeaseStatus.ACTIVE },
    })
    if (leases.length === 0) {
      return null
    }
    const listings = await this.listingRepository.find({
      where: { id: In([...new Set(leases.map((lease) => lease.listingId))]) },
    })
    const listingMap = new Map(listings.map((listing) => [listing.id, listing]))
    for (const lease of leases) {
      const listing = listingMap.get(lease.listingId)
      if (listing && listing.regionId === regionId) {
        return { lease, listing }
      }
    }
    return null
  }

  async listForProvider(providerOrganizationId: string): Promise<MarketLeaseDto[]> {
    const listings = await this.listingRepository.find({ where: { providerOrganizationId } })
    if (listings.length === 0) {
      return []
    }
    const leases = await this.leaseRepository.find({
      where: { listingId: In(listings.map((listing) => listing.id)) },
      order: { createdAt: 'DESC' },
    })
    return this.toDtos(leases, new Map(listings.map((listing) => [listing.id, listing])))
  }

  async open(consumerOrganizationId: string, dto: CreateMarketLeaseDto): Promise<MarketLeaseDto> {
    const listing = await this.listingRepository.findOne({ where: { id: dto.listingId } })
    if (!listing) {
      throw new NotFoundException('Listing not found')
    }
    if (listing.status !== MarketListingStatus.PUBLISHED) {
      throw new BadRequestException(`Listing is not available for lease (status=${listing.status})`)
    }

    const requested = {
      totalCpu: dto.totalCpu ?? listing.totalCpu,
      totalMemoryGiB: dto.totalMemoryGiB ?? listing.totalMemoryGiB,
      totalDiskGiB: dto.totalDiskGiB ?? listing.totalDiskGiB,
    }
    if (
      requested.totalCpu < 1 ||
      requested.totalMemoryGiB < 1 ||
      requested.totalDiskGiB < 1 ||
      requested.totalCpu > listing.totalCpu ||
      requested.totalMemoryGiB > listing.totalMemoryGiB ||
      requested.totalDiskGiB > listing.totalDiskGiB
    ) {
      throw new BadRequestException('Requested capacity is outside the listing capacity')
    }

    // M2: require enough balance for at least one hour of the requested capacity.
    const hourlyCents = Math.ceil(
      requested.totalCpu * listing.cpuHourCents +
        requested.totalMemoryGiB * listing.memoryGiBHourCents +
        requested.totalDiskGiB * listing.diskGiBHourCents,
    )
    if (hourlyCents > 0) {
      const balance = await this.creditService.getBalance(consumerOrganizationId)
      if (balance.balanceCents < hourlyCents) {
        throw new ForbiddenException(
          `Insufficient market balance: need at least ${hourlyCents} cents for one hour, current balance is ${balance.balanceCents} cents`,
        )
      }
    }

    let lease = await this.leaseRepository.findOne({
      where: { consumerOrganizationId, listingId: listing.id, status: MarketLeaseStatus.ACTIVE },
    })

    if (lease) {
      lease.totalCpu = requested.totalCpu
      lease.totalMemoryGiB = requested.totalMemoryGiB
      lease.totalDiskGiB = requested.totalDiskGiB
      lease = await this.leaseRepository.save(lease)
    } else {
      lease = new MarketLease({
        listingId: listing.id,
        consumerOrganizationId,
        status: MarketLeaseStatus.ACTIVE,
        currency: listing.currency,
        cpuHourCents: listing.cpuHourCents,
        memoryGiBHourCents: listing.memoryGiBHourCents,
        diskGiBHourCents: listing.diskGiBHourCents,
        gpuHourCents: listing.gpuHourCents,
        totalCpu: requested.totalCpu,
        totalMemoryGiB: requested.totalMemoryGiB,
        totalDiskGiB: requested.totalDiskGiB,
        maxCpuPerSandbox: listing.maxCpuPerSandbox,
        maxMemoryPerSandbox: listing.maxMemoryPerSandbox,
        maxDiskPerSandbox: listing.maxDiskPerSandbox,
      })
      lease = await this.leaseRepository.save(lease)
    }

    await this.grantRegionQuota(consumerOrganizationId, listing, requested)

    return this.toDto(lease, listing)
  }

  async close(consumerOrganizationId: string, leaseId: string): Promise<MarketLeaseDto> {
    const lease = await this.leaseRepository.findOne({ where: { id: leaseId } })
    if (!lease || lease.consumerOrganizationId !== consumerOrganizationId) {
      throw new NotFoundException('Lease not found')
    }
    if (lease.status !== MarketLeaseStatus.ACTIVE) {
      throw new ConflictException('Lease is already closed')
    }

    lease.status = MarketLeaseStatus.CLOSED
    lease.closedAt = new Date()
    const saved = await this.leaseRepository.save(lease)

    const listing = await this.listingRepository.findOne({ where: { id: lease.listingId } })
    if (listing) {
      const otherActiveLeases = await this.leaseRepository.count({
        where: {
          consumerOrganizationId,
          listingId: listing.id,
          status: MarketLeaseStatus.ACTIVE,
        },
      })
      if (otherActiveLeases === 0) {
        try {
          const sandboxClass = this.configService.getOrThrow('defaultSandboxClass')
          await this.organizationService.deleteRegionQuota(consumerOrganizationId, listing.regionId, sandboxClass)
        } catch (error) {
          // Quotas are additive; a missing row should never block closing a lease.
          this.logger.warn(`Failed to revoke region quota on lease close: ${(error as Error).message}`)
        }
      }
    }

    return this.toDto(saved, listing)
  }

  private async grantRegionQuota(
    consumerOrganizationId: string,
    listing: MarketListing,
    requested: { totalCpu: number; totalMemoryGiB: number; totalDiskGiB: number },
  ): Promise<void> {
    const region = await this.regionRepository.findOne({ where: { id: listing.regionId } })
    if (!region) {
      throw new NotFoundException('Listing region not found')
    }
    if (!region.enforceQuotas) {
      throw new BadRequestException('Listing region does not enforce quotas')
    }

    const sandboxClass = this.configService.getOrThrow('defaultSandboxClass')
    const existing = await this.organizationService.getRegionQuota(consumerOrganizationId, region.id, sandboxClass)

    if (!existing) {
      await this.organizationService.createRegionQuota(consumerOrganizationId, region.id, {
        sandboxClass,
        totalCpuQuota: requested.totalCpu,
        totalMemoryQuota: requested.totalMemoryGiB,
        totalDiskQuota: requested.totalDiskGiB,
        totalGpuQuota: 0,
        maxCpuPerSandbox: listing.maxCpuPerSandbox,
        maxMemoryPerSandbox: listing.maxMemoryPerSandbox,
        maxDiskPerSandbox: listing.maxDiskPerSandbox,
      })
      return
    }

    await this.organizationService.updateRegionQuota(consumerOrganizationId, region.id, {
      sandboxClass,
      totalCpuQuota: requested.totalCpu,
      totalMemoryQuota: requested.totalMemoryGiB,
      totalDiskQuota: requested.totalDiskGiB,
      totalGpuQuota: existing.totalGpuQuota,
      maxCpuPerSandbox: Math.max(existing.maxCpuPerSandbox ?? 0, listing.maxCpuPerSandbox),
      maxMemoryPerSandbox: Math.max(existing.maxMemoryPerSandbox ?? 0, listing.maxMemoryPerSandbox),
      maxDiskPerSandbox: Math.max(existing.maxDiskPerSandbox ?? 0, listing.maxDiskPerSandbox),
    })
  }

  private async toDtos(leases: MarketLease[], knownListings?: Map<string, MarketListing>): Promise<MarketLeaseDto[]> {
    if (leases.length === 0) {
      return []
    }
    const listingMap = new Map(knownListings ?? [])
    const missingListingIds = leases.map((lease) => lease.listingId).filter((listingId) => !listingMap.has(listingId))
    if (missingListingIds.length > 0) {
      const rows = await this.listingRepository.find({ where: { id: In([...new Set(missingListingIds)]) } })
      for (const listing of rows) {
        listingMap.set(listing.id, listing)
      }
    }

    const regionIds = [...new Set([...listingMap.values()].map((listing) => listing.regionId))]
    const regionNameMap = new Map<string, string>()
    if (regionIds.length > 0) {
      const regions = await this.regionService.findByIds(regionIds)
      for (const region of regions) {
        regionNameMap.set(region.id, region.name)
      }
    }

    return leases.map((lease) => {
      const listing = listingMap.get(lease.listingId) ?? null
      return MarketLeaseDto.fromEntity(lease, listing, listing ? (regionNameMap.get(listing.regionId) ?? null) : null)
    })
  }

  private async toDto(lease: MarketLease, listing?: MarketListing | null): Promise<MarketLeaseDto> {
    const [dto] = await this.toDtos([lease], listing ? new Map([[listing.id, listing]]) : undefined)
    return dto
  }
}
