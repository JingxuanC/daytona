/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

/**
 * Revoked Roost credential. The row lives exactly as long as the JWT could still be
 * valid (`expiresAt` = issue `exp` when known, otherwise now + max TTL), so no
 * unbounded revocation table is ever kept.
 */
@Entity('roost_revoked_credentials')
export class RoostRevokedCredential {
  @PrimaryColumn({ type: 'character varying' })
  jti: string

  @Column({ type: 'character varying', nullable: true })
  aud: string | null

  @Column({ type: 'character varying', nullable: true })
  orgId: string | null

  @Column({ type: 'character varying', nullable: true })
  sandboxId: string | null

  @Column({ type: 'character varying', nullable: true })
  scope: string | null

  @Column({ type: 'character varying', nullable: true })
  reason: string | null

  /** Remaining lifetime of the revoked credential; the row is deleted after this instant. */
  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date

  @CreateDateColumn({ type: 'timestamp with time zone' })
  revokedAt: Date
}
