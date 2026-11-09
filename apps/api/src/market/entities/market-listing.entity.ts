/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { MarketListingStatus, MarketListingVisibility } from '../enums/market-listing-status.enum'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'

/**
 * A provider's sellable compute capacity on top of one of its own regions.
 *
 * M1 keeps this listing-based (no dedicated region type): publishing a listing
 * turns quota enforcement on for the region and grants consumer organizations a
 * region quota when they open a lease.
 */
@Entity('market_listings')
@Index('market_listings_provider_region_unique', ['providerOrganizationId', 'regionId'], { unique: true })
@Index('market_listings_status_index', ['status'])
export class MarketListing {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  providerOrganizationId: string

  @Column()
  regionId: string

  @Column()
  name: string

  @Column({ type: 'text', nullable: true })
  description: string | null

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

  @Column({ type: 'int', default: 10 })
  maxCpuPerSandbox: number

  @Column({ type: 'int', default: 16 })
  maxMemoryPerSandbox: number

  @Column({ type: 'int', default: 100 })
  maxDiskPerSandbox: number

  @Column({ type: 'int', default: 10 })
  maxSandboxes: number

  @Column({ type: 'enum', enum: MarketListingVisibility, default: MarketListingVisibility.PUBLIC })
  visibility: MarketListingVisibility

  @Column({ type: 'enum', enum: MarketListingStatus, default: MarketListingStatus.PUBLISHED })
  status: MarketListingStatus

  /** SLA availability target (percent) used for daily breach evaluation. */
  @Column({ type: 'int', default: 99 })
  slaAvailabilityPct: number

  /** Compensation paid to the consumer on breach, in basis points of that day's charge. */
  @Column({ type: 'int', default: 500 })
  slaCompensationBps: number

  @Column({ type: 'int', default: 0 })
  platformFeeBps: number

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date

  constructor(partial?: Partial<MarketListing>) {
    Object.assign(this, partial)
  }
}
