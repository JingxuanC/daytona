/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

/**
 * Per compute node counter for sandbox start attempts, used to derive the startup success
 * rate and average startup duration shown in the provider console.
 */
@Entity('runner_daily_metrics')
@Unique(['runnerId', 'date'])
@Index(['organizationId', 'date'])
export class RunnerDailyMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  organizationId: string

  @Column()
  runnerId: string

  /** UTC day, formatted as YYYY-MM-DD */
  @Column({ type: 'date' })
  date: string

  @Column({ type: 'int', default: 0 })
  sandboxStarts: number

  @Column({ type: 'int', default: 0 })
  sandboxStartFailures: number

  @Column({ type: 'float', default: 0 })
  totalStartupSeconds: number

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date
}
