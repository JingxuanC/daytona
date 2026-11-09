/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'
import { MarketCreditEntryType } from '../enums/market-credit-entry-type.enum'

/**
 * Append-only consumer credit ledger for market spend.
 *
 * `amountCents` is signed: top-up/adjustment entries are positive, usage charges are negative.
 * `balanceAfterCents` lets reads avoid summing the whole ledger.
 */
@Entity('market_credit_entries')
@Index('market_credit_entries_org_created_index', ['organizationId', 'createdAt'])
@Index('market_credit_entries_usage_unique', ['organizationId', 'referenceId'], {
  unique: true,
  where: `"referenceType" = 'market_usage'`,
})
export class MarketCreditEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  organizationId: string

  @Column({ type: 'character varying' })
  type: MarketCreditEntryType

  @Column({ type: 'int' })
  amountCents: number

  @Column({ type: 'int' })
  balanceAfterCents: number

  @Column({ type: 'character varying', default: DEFAULT_PRICING_CURRENCY })
  currency: string

  @Column({ type: 'character varying', nullable: true })
  description: string | null

  @Column({ type: 'character varying', nullable: true })
  referenceType: string | null

  @Column({ type: 'character varying', nullable: true })
  referenceId: string | null

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  constructor(partial?: Partial<MarketCreditEntry>) {
    Object.assign(this, partial)
  }
}
