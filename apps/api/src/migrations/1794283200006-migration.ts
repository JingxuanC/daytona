/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Compute market M4 (operations + risk):
 * - market_settings: runtime-tunable platform settings (e.g. platformFeeBps)
 * - market_alerts: consumer risk alerts (low / negative balance)
 */
export class Migration1794283200006 implements MigrationInterface {
  name = 'Migration1794283200006'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_settings" (
        "key" character varying NOT NULL,
        "value" character varying NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "market_settings_key_pk" PRIMARY KEY ("key")
      )
    `)

    await queryRunner.query(`
      CREATE TABLE "market_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" character varying NOT NULL,
        "type" character varying NOT NULL,
        "severity" character varying NOT NULL DEFAULT 'warning',
        "message" text NOT NULL,
        "details" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "market_alerts_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE INDEX "market_alerts_org_type_resolved_index" ON "market_alerts" ("organizationId", "type", "resolvedAt")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "market_alerts"`)
    await queryRunner.query(`DROP TABLE "market_settings"`)
  }
}
