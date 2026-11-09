/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Provider console observability:
 * - runner RTT / health failure counters
 * - runner_daily_metrics: per node per UTC day sandbox start counters and durations
 * - runner_alerts: offline / health / latency / resource pressure alerts
 */
export class Migration1794283200003 implements MigrationInterface {
  name = 'Migration1794283200003'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "runner" ADD "lastRttMs" double precision`)
    await queryRunner.query(`ALTER TABLE "runner" ADD "lastRttAt" TIMESTAMP WITH TIME ZONE`)
    await queryRunner.query(`ALTER TABLE "runner" ADD "consecutiveHealthFailures" integer NOT NULL DEFAULT 0`)

    await queryRunner.query(`
      CREATE TABLE "runner_daily_metrics" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" character varying NOT NULL,
        "runnerId" character varying NOT NULL,
        "date" date NOT NULL,
        "sandboxStarts" integer NOT NULL DEFAULT 0,
        "sandboxStartFailures" integer NOT NULL DEFAULT 0,
        "totalStartupSeconds" double precision NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "runner_daily_metrics_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "runner_daily_metrics_runnerId_date_unique" ON "runner_daily_metrics" ("runnerId", "date")`,
    )
    await queryRunner.query(
      `CREATE INDEX "runner_daily_metrics_organizationId_date_index" ON "runner_daily_metrics" ("organizationId", "date")`,
    )

    await queryRunner.query(`
      CREATE TABLE "runner_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" character varying NOT NULL,
        "runnerId" character varying NOT NULL,
        "type" character varying NOT NULL,
        "severity" character varying NOT NULL DEFAULT 'WARNING',
        "message" text NOT NULL,
        "details" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "runner_alerts_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE INDEX "runner_alerts_organizationId_resolvedAt_index" ON "runner_alerts" ("organizationId", "resolvedAt")`,
    )
    await queryRunner.query(
      `CREATE INDEX "runner_alerts_runnerId_type_resolvedAt_index" ON "runner_alerts" ("runnerId", "type", "resolvedAt")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "runner_alerts"`)
    await queryRunner.query(`DROP TABLE "runner_daily_metrics"`)
    await queryRunner.query(`ALTER TABLE "runner" DROP COLUMN "consecutiveHealthFailures"`)
    await queryRunner.query(`ALTER TABLE "runner" DROP COLUMN "lastRttAt"`)
    await queryRunner.query(`ALTER TABLE "runner" DROP COLUMN "lastRttMs"`)
  }
}
