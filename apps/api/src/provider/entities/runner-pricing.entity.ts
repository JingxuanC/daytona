/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

export const DEFAULT_PRICING_CURRENCY = 'CNY'

/**
 * Hourly unit prices (in integer cents) used to convert provider usage into revenue.
 * One row per runner (compute node).
 */
@Entity('runner_pricing')
@Unique(['runnerId'])
@Index(['organizationId'])
export class RunnerPricing {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  organizationId: string

  @Column()
  runnerId: string

  @Column({ type: 'int', default: 0 })
  cpuHourCents: number

  @Column({ type: 'int', default: 0 })
  memoryGiBHourCents: number

  @Column({ type: 'int', default: 0 })
  diskGiBHourCents: number

  @Column({ type: 'int', default: 0 })
  gpuHourCents: number

  @Column({ type: 'character varying', default: DEFAULT_PRICING_CURRENCY })
  currency: string

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date
}
