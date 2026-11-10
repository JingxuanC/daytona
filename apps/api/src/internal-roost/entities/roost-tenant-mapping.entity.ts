/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { CreateDateColumn, Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * Maps a market-service tenant (`external_id`) to a Daytona organization.
 *
 * `externalId` is unique, which makes `POST /internal/roost/v1/tenants` idempotent.
 */
@Entity('roost_tenant_mappings')
export class RoostTenantMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'character varying' })
  externalId: string

  @Column({ type: 'uuid' })
  organizationId: string

  @Column({ type: 'character varying', default: 'ready' })
  state: string

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date
}
