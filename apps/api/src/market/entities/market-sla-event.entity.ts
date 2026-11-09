/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'

/**
 * SLA breach record for a charged lease day. Compensation is credited to the consumer
 * (platform-funded in M4) and recorded here for audit; unique per charge.
 */
@Entity('market_sla_events')
@Index('market_sla_events_charge_unique', ['chargeId'], { unique: true })
@Index('market_sla_events_consumer_index', ['consumerOrganizationId', 'periodStart'])
export class MarketSlaEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  chargeId: string

  @Column({ type: 'uuid' })
  leaseId: string

  @Column()
  consumerOrganizationId: string

  @Column()
  providerOrganizationId: string

  @Column({ type: 'date' })
  periodStart: string

  @Column({ type: 'float', default: 0 })
  availabilityPct: number

  @Column({ type: 'int' })
  requiredAvailabilityPct: number

  @Column({ type: 'int', default: 0 })
  compensationCents: number

  @Column({ type: 'character varying', default: DEFAULT_PRICING_CURRENCY })
  currency: string

  @Column({ type: 'text' })
  reason: string

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  constructor(partial?: Partial<MarketSlaEvent>) {
    Object.assign(this, partial)
  }
}
