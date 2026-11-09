/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export enum RunnerAlertType {
  /** The control plane has not received a heartbeat within the threshold. */
  OFFLINE = 'OFFLINE',
  /** The node is reachable but the health probe keeps failing. */
  HEALTHCHECK_FAILED = 'HEALTHCHECK_FAILED',
  /** Round trip time to the node is above the threshold. */
  HIGH_LATENCY = 'HIGH_LATENCY',
  /** CPU or memory usage is above the threshold. */
  RESOURCE_PRESSURE = 'RESOURCE_PRESSURE',
}

export enum RunnerAlertSeverity {
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

/**
 * An alert raised for a compute node. At most one open (unresolved) alert exists per
 * node and alert type; recovery resolves it automatically.
 */
@Entity('runner_alerts')
@Index(['organizationId', 'resolvedAt'])
@Index(['runnerId', 'type', 'resolvedAt'])
export class RunnerAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  organizationId: string

  @Column()
  runnerId: string

  @Column({ type: 'character varying' })
  type: RunnerAlertType

  @Column({ type: 'character varying', default: RunnerAlertSeverity.WARNING })
  severity: RunnerAlertSeverity

  @Column({ type: 'text' })
  message: string

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @Column({ type: 'timestamp with time zone', nullable: true })
  resolvedAt: Date | null
}
