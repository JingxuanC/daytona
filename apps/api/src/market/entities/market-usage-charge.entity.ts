/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'

/**
 * One settled usage charge for a consumer lease and UTC day.
 * Unique per (leaseId, periodStart) so re-running the charging job is idempotent.
 */
@Entity('market_usage_charges')
@Index('market_usage_charges_lease_period_unique', ['leaseId', 'periodStart'], { unique: true })
@Index('market_usage_charges_consumer_index', ['consumerOrganizationId', 'periodStart'])
export class MarketUsageCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  leaseId: string

  @Column({ type: 'uuid' })
  listingId: string

  @Column()
  consumerOrganizationId: string

  @Column()
  providerOrganizationId: string

  @Column({ type: 'date' })
  periodStart: string

  @Column({ type: 'float', default: 0 })
  cpuHours: number

  @Column({ type: 'float', default: 0 })
  memoryGiBHours: number

  @Column({ type: 'float', default: 0 })
  diskGiBHours: number

  @Column({ type: 'float', default: 0 })
  gpuHours: number

  @Column({ type: 'int', default: 0 })
  amountCents: number

  @Column({ type: 'int', default: 0 })
  platformFeeCents: number

  @Column({ type: 'int', default: 0 })
  providerNetCents: number

  @Column({ type: 'character varying', default: DEFAULT_PRICING_CURRENCY })
  currency: string

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  constructor(partial?: Partial<MarketUsageCharge>) {
    Object.assign(this, partial)
  }
}
