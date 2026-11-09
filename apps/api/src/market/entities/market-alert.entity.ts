/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { MarketAlertSeverity, MarketAlertType } from '../enums/market-alert-type.enum'

/**
 * Risk alerts raised for consumer organizations, e.g. low or negative market balance.
 * Deduplicated per (organizationId, type) while unresolved; resolved automatically on recovery.
 */
@Entity('market_alerts')
@Index('market_alerts_org_type_resolved_index', ['organizationId', 'type', 'resolvedAt'])
export class MarketAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  organizationId: string

  @Column({ type: 'character varying' })
  type: MarketAlertType

  @Column({ type: 'character varying', default: MarketAlertSeverity.WARNING })
  severity: MarketAlertSeverity

  @Column({ type: 'text' })
  message: string

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @Column({ type: 'timestamp with time zone', nullable: true })
  resolvedAt: Date | null

  constructor(partial?: Partial<MarketAlert>) {
    Object.assign(this, partial)
  }
}
