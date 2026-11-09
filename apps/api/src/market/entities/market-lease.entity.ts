/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { MarketLeaseStatus } from '../enums/market-lease-status.enum'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'

/**
 * A consumer organization's entitlement to use a market listing.
 *
 * Price fields are a snapshot taken when the lease is opened so later provider
 * price changes never rewrite an existing consumer's bill (M1 is display-only).
 */
@Entity('market_leases')
@Index('market_leases_active_unique', ['consumerOrganizationId', 'listingId'], {
  unique: true,
  where: `"status" = 'active'`,
})
@Index('market_leases_listing_status_index', ['listingId', 'status'])
export class MarketLease {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  listingId: string

  @Column()
  consumerOrganizationId: string

  @Column({ type: 'enum', enum: MarketLeaseStatus, default: MarketLeaseStatus.ACTIVE })
  status: MarketLeaseStatus

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

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @Column({ type: 'timestamp with time zone', nullable: true })
  closedAt: Date | null

  constructor(partial?: Partial<MarketLease>) {
    Object.assign(this, partial)
  }
}
