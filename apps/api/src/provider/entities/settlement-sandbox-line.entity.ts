/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm'

/**
 * Per-sandbox breakdown of a settlement period, so providers can see which sandboxes
 * generated their revenue.
 */
@Entity('settlement_sandbox_lines')
@Unique(['settlementPeriodId', 'sandboxId'])
@Index(['settlementPeriodId'])
@Index(['organizationId', 'periodStart'])
export class SettlementSandboxLine {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  settlementPeriodId: string

  @Column()
  organizationId: string

  @Column()
  runnerId: string

  /** Inclusive UTC day, formatted as YYYY-MM-DD */
  @Column({ type: 'date' })
  periodStart: string

  @Column()
  sandboxId: string

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

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date
}
