/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { MarketBid, MarketBidStatus } from '../entities/market-bid.entity'
import { MarketListing } from '../entities/market-listing.entity'
import { MarketListingStatus } from '../enums/market-listing-status.enum'
import { CreateMarketBidDto, MarketBidDto } from '../dto/market-bid.dto'
import { MarketLeaseDto } from '../dto/market-lease.dto'
import { MarketLeasesService } from './market-leases.service'

/**
 * Consumer price bids for market listings (M4). A provider accepts a bid to turn it into
 * a lease priced with the bid snapshot; pending bids are unique per (consumer, listing).
 */
@Injectable()
export class MarketBidsService {
  constructor(
    @InjectRepository(MarketBid)
    private readonly bidRepository: Repository<MarketBid>,
    @InjectRepository(MarketListing)
    private readonly listingRepository: Repository<MarketListing>,
    private readonly leasesService: MarketLeasesService,
  ) {}

  async create(consumerOrganizationId: string, dto: CreateMarketBidDto): Promise<MarketBidDto> {
    const listing = await this.listingRepository.findOne({ where: { id: dto.listingId } })
    if (!listing || listing.status !== MarketListingStatus.PUBLISHED) {
      throw new NotFoundException('Listing not found')
    }
    if (
      dto.totalCpu < 1 ||
      dto.totalMemoryGiB < 1 ||
      dto.totalDiskGiB < 1 ||
      dto.totalCpu > listing.totalCpu ||
      dto.totalMemoryGiB > listing.totalMemoryGiB ||
      dto.totalDiskGiB > listing.totalDiskGiB
    ) {
      throw new BadRequestException('Requested capacity is outside the listing capacity')
    }

    let bid = await this.bidRepository.findOne({
      where: { consumerOrganizationId, listingId: listing.id, status: MarketBidStatus.PENDING },
    })
    const fields = {
      listingId: listing.id,
      consumerOrganizationId,
      status: MarketBidStatus.PENDING,
      currency: listing.currency,
      cpuHourCents: dto.cpuHourCents,
      memoryGiBHourCents: dto.memoryGiBHourCents,
      diskGiBHourCents: dto.diskGiBHourCents,
      gpuHourCents: dto.gpuHourCents ?? 0,
      totalCpu: dto.totalCpu,
      totalMemoryGiB: dto.totalMemoryGiB,
      totalDiskGiB: dto.totalDiskGiB,
      message: dto.message ?? null,
    }
    if (bid) {
      Object.assign(bid, fields)
    } else {
      bid = new MarketBid(fields)
    }
    const saved = await this.bidRepository.save(bid)
    return MarketBidDto.fromEntity(saved, listing)
  }

  async listForConsumer(consumerOrganizationId: string): Promise<MarketBidDto[]> {
    const bids = await this.bidRepository.find({
      where: { consumerOrganizationId },
      order: { createdAt: 'DESC' },
      take: 100,
    })
    return this.toDtos(bids)
  }

  async withdraw(consumerOrganizationId: string, bidId: string): Promise<MarketBidDto> {
    const bid = await this.bidRepository.findOne({ where: { id: bidId } })
    if (!bid || bid.consumerOrganizationId !== consumerOrganizationId) {
      throw new NotFoundException('Bid not found')
    }
    if (bid.status !== MarketBidStatus.PENDING) {
      throw new ConflictException(`Bid is already ${bid.status}`)
    }
    bid.status = MarketBidStatus.WITHDRAWN
    bid.resolvedAt = new Date()
    const saved = await this.bidRepository.save(bid)
    return this.toDtos([saved]).then((items) => items[0])
  }

  async listForProvider(providerOrganizationId: string): Promise<MarketBidDto[]> {
    const listings = await this.listingRepository.find({ where: { providerOrganizationId } })
    if (listings.length === 0) {
      return []
    }
    const listingIds = listings.map((listing) => listing.id)
    const bids = await this.bidRepository.find({
      where: { listingId: In(listingIds) },
      order: { createdAt: 'DESC' },
      take: 200,
    })
    const listingMap = new Map(listings.map((listing) => [listing.id, listing]))
    return bids.map((bid) => MarketBidDto.fromEntity(bid, listingMap.get(bid.listingId)))
  }

  async accept(providerOrganizationId: string, bidId: string): Promise<MarketLeaseDto> {
    const bid = await this.bidRepository.findOne({ where: { id: bidId } })
    if (!bid) {
      throw new NotFoundException('Bid not found')
    }
    if (bid.status !== MarketBidStatus.PENDING) {
      throw new ConflictException(`Bid is already ${bid.status}`)
    }
    const listing = await this.listingRepository.findOne({ where: { id: bid.listingId } })
    if (!listing || listing.providerOrganizationId !== providerOrganizationId) {
      throw new NotFoundException('Bid not found')
    }
    if (listing.status !== MarketListingStatus.PUBLISHED) {
      throw new BadRequestException(`Listing is not available for lease (status=${listing.status})`)
    }

    const requested = {
      totalCpu: bid.totalCpu,
      totalMemoryGiB: bid.totalMemoryGiB,
      totalDiskGiB: bid.totalDiskGiB,
    }
    const prices = {
      currency: bid.currency,
      cpuHourCents: bid.cpuHourCents,
      memoryGiBHourCents: bid.memoryGiBHourCents,
      diskGiBHourCents: bid.diskGiBHourCents,
      gpuHourCents: bid.gpuHourCents,
    }

    await this.leasesService.assertSufficientBalance(bid.consumerOrganizationId, requested, prices)
    const lease = await this.leasesService.applyLease(bid.consumerOrganizationId, listing, requested, prices)

    bid.status = MarketBidStatus.ACCEPTED
    bid.leaseId = lease.id
    bid.resolvedAt = new Date()
    await this.bidRepository.save(bid)

    return MarketLeaseDto.fromEntity(lease, listing)
  }

  async reject(providerOrganizationId: string, bidId: string): Promise<MarketBidDto> {
    const bid = await this.bidRepository.findOne({ where: { id: bidId } })
    if (!bid) {
      throw new NotFoundException('Bid not found')
    }
    const listing = await this.listingRepository.findOne({ where: { id: bid.listingId } })
    if (!listing || listing.providerOrganizationId !== providerOrganizationId) {
      throw new NotFoundException('Bid not found')
    }
    if (bid.status !== MarketBidStatus.PENDING) {
      throw new ConflictException(`Bid is already ${bid.status}`)
    }
    bid.status = MarketBidStatus.REJECTED
    bid.resolvedAt = new Date()
    const saved = await this.bidRepository.save(bid)
    return MarketBidDto.fromEntity(saved, listing)
  }

  private async toDtos(bids: MarketBid[]): Promise<MarketBidDto[]> {
    if (bids.length === 0) {
      return []
    }
    const listingIds = [...new Set(bids.map((bid) => bid.listingId))]
    const listings = await this.listingRepository.find({ where: { id: In(listingIds) } })
    const listingMap = new Map(listings.map((listing) => [listing.id, listing]))
    return bids.map((bid) => MarketBidDto.fromEntity(bid, listingMap.get(bid.listingId)))
  }
}
