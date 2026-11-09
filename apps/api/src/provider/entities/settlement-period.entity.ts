/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

export enum SettlementStatus {
  /** Usage has been priced but the platform has not settled it yet. */
  PENDING = 'PENDING',
  /** The platform has settled the amount; it is payable to the provider. */
  SETTLED = 'SETTLED',
  /** The provider has requested a withdrawal. */
  WITHDRAWING = 'WITHDRAWING',
  /** The amount has been paid out. */
  WITHDRAWN = 'WITHDRAWN',
}

/**
 * One settlement row per provider node per UTC day. Amounts are stored in integer cents.
 */
@Entity('settlement_periods')
@Unique(['runnerId', 'periodStart'])
@Index(['organizationId', 'periodStart'])
@Index(['status'])
export class SettlementPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  organizationId: string

  @Column()
  runnerId: string

  /** Inclusive UTC day, formatted as YYYY-MM-DD */
  @Column({ type: 'date' })
  periodStart: string

  /** Inclusive UTC day, formatted as YYYY-MM-DD (equals periodStart for daily settlement) */
  @Column({ type: 'date' })
  periodEnd: string

  @Column({ type: 'character varying', default: SettlementStatus.PENDING })
  status: SettlementStatus

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

  @Column({ type: 'character varying', default: 'CNY' })
  currency: string

  @Column({ type: 'timestamp with time zone', nullable: true })
  settledAt: Date | null

  @Column({ type: 'timestamp with time zone', nullable: true })
  withdrawnAt: Date | null

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date
}
