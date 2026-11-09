/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * Runtime-tunable platform settings for the compute market (M4 operations).
 * Keys are stable strings, e.g. `platformFeeBps`.
 */
@Entity('market_settings')
export class MarketSetting {
  @PrimaryColumn({ type: 'character varying' })
  key: string

  @Column({ type: 'character varying' })
  value: string

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date
}
