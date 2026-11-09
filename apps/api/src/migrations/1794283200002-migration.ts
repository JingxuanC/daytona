/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Compute provider pricing and settlement tables.
 *
 * - runner_pricing: hourly unit prices per compute node
 * - settlement_periods: priced usage per node per UTC day (integer cents)
 * - settlement_sandbox_lines: per-sandbox breakdown of a settlement period
 */
export class Migration1794283200002 implements MigrationInterface {
  name = 'Migration1794283200002'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "runner_pricing" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" character varying NOT NULL,
        "runnerId" character varying NOT NULL,
        "cpuHourCents" integer NOT NULL DEFAULT 0,
        "memoryGiBHourCents" integer NOT NULL DEFAULT 0,
        "diskGiBHourCents" integer NOT NULL DEFAULT 0,
        "gpuHourCents" integer NOT NULL DEFAULT 0,
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "runner_pricing_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "runner_pricing_runnerId_unique" ON "runner_pricing" ("runnerId")`,
    )
    await queryRunner.query(
      `CREATE INDEX "runner_pricing_organizationId_index" ON "runner_pricing" ("organizationId")`,
    )

    await queryRunner.query(`
      CREATE TABLE "settlement_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" character varying NOT NULL,
        "runnerId" character varying NOT NULL,
        "periodStart" date NOT NULL,
        "periodEnd" date NOT NULL,
        "status" character varying NOT NULL DEFAULT 'PENDING',
        "cpuHours" double precision NOT NULL DEFAULT 0,
        "memoryGiBHours" double precision NOT NULL DEFAULT 0,
        "diskGiBHours" double precision NOT NULL DEFAULT 0,
        "gpuHours" double precision NOT NULL DEFAULT 0,
        "amountCents" integer NOT NULL DEFAULT 0,
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "settledAt" TIMESTAMP WITH TIME ZONE,
        "withdrawnAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "settlement_periods_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "settlement_periods_runnerId_periodStart_unique" ON "settlement_periods" ("runnerId", "periodStart")`,
    )
    await queryRunner.query(
      `CREATE INDEX "settlement_periods_organizationId_periodStart_index" ON "settlement_periods" ("organizationId", "periodStart")`,
    )
    await queryRunner.query(`CREATE INDEX "settlement_periods_status_index" ON "settlement_periods" ("status")`)

    await queryRunner.query(`
      CREATE TABLE "settlement_sandbox_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "settlementPeriodId" uuid NOT NULL,
        "organizationId" character varying NOT NULL,
        "runnerId" character varying NOT NULL,
        "periodStart" date NOT NULL,
        "sandboxId" character varying NOT NULL,
        "cpuHours" double precision NOT NULL DEFAULT 0,
        "memoryGiBHours" double precision NOT NULL DEFAULT 0,
        "diskGiBHours" double precision NOT NULL DEFAULT 0,
        "gpuHours" double precision NOT NULL DEFAULT 0,
        "amountCents" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "settlement_sandbox_lines_id_pk" PRIMARY KEY ("id"),
        CONSTRAINT "settlement_sandbox_lines_settlementPeriodId_fk" FOREIGN KEY ("settlementPeriodId") REFERENCES "settlement_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "settlement_sandbox_lines_settlementPeriodId_sandboxId_unique" ON "settlement_sandbox_lines" ("settlementPeriodId", "sandboxId")`,
    )
    await queryRunner.query(
      `CREATE INDEX "settlement_sandbox_lines_organizationId_periodStart_index" ON "settlement_sandbox_lines" ("organizationId", "periodStart")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settlement_sandbox_lines"`)
    await queryRunner.query(`DROP TABLE "settlement_periods"`)
    await queryRunner.query(`DROP TABLE "runner_pricing"`)
  }
}
