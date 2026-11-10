/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { SandboxClass } from '../../sandbox/enums/sandbox-class.enum'

/**
 * One quota contribution (a `source`, e.g. `lease:<lease_id>` or `provider:self`) on a
 * region for an organization / sandbox class.
 *
 * Quotas delivered through the internal API are aggregated from these rows and
 * materialized into the existing `region_quota` table so the regular sandbox quota
 * enforcement keeps working unchanged:
 *
 * - totals (cpu/memory/disk): sum over all sources
 * - per-sandbox limits: max over all sources
 */
@Entity('region_quota_sources')
export class RegionQuotaSource {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'character varying' })
  regionId: string

  @Column({ type: 'uuid' })
  organizationId: string

  @Column({ type: 'character varying', default: SandboxClass.CONTAINER })
  sandboxClass: SandboxClass

  @Column({ type: 'character varying' })
  source: string

  @Column({ type: 'int', default: 0 })
  totalCpuQuota: number

  @Column({ type: 'int', default: 0 })
  totalMemoryQuota: number

  @Column({ type: 'int', default: 0 })
  totalDiskQuota: number

  @Column({ type: 'int', nullable: true })
  maxCpuPerSandbox: number | null

  @Column({ type: 'int', nullable: true })
  maxMemoryPerSandbox: number | null

  @Column({ type: 'int', nullable: true })
  maxDiskPerSandbox: number | null

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date
}
