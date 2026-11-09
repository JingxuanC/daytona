/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'

export enum MarketBidStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

/**
 * A consumer's price bid for a listing. When the provider accepts it, the bid price snapshot
 * becomes the lease price (bids are only ever accepted at or below capacity of the listing).
 */
@Entity('market_bids')
@Index('market_bids_pending_unique', ['consumerOrganizationId', 'listingId'], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Index('market_bids_listing_status_index', ['listingId', 'status'])
export class MarketBid {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  listingId: string

  @Column()
  consumerOrganizationId: string

  @Column({ type: 'character varying', default: MarketBidStatus.PENDING })
  status: MarketBidStatus

  @Column({ type: 'character varying', default: DEFAULT_PRICING_CURRENCY })
  currency: string

  @Column({ type: 'int', default: 0 })
  cpuHourCents: number

  @Column({ type: 'int', default: 0 })
  memoryGiBHourCents: number

  @Column({ type: 'int', default: 0 })
  diskGiBHourCents: number

  @Column({ type: 'int', default: 0 })
  gpuHourCents: number

  @Column({ type: 'int' })
  totalCpu: number

  @Column({ type: 'int' })
  totalMemoryGiB: number

  @Column({ type: 'int' })
  totalDiskGiB: number

  @Column({ type: 'character varying', nullable: true })
  message: string | null

  @Column({ type: 'uuid', nullable: true })
  leaseId: string | null

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @Column({ type: 'timestamp with time zone', nullable: true })
  resolvedAt: Date | null

  constructor(partial?: Partial<MarketBid>) {
    Object.assign(this, partial)
  }
}
