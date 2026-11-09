/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Compute market M2:
 * - market_credit_entries: append-only consumer credit ledger (top-up / usage charge)
 * - market_usage_charges: idempotent per-lease per-day usage charge records
 * - settlement_periods: platform commission and provider net amount
 */
export class Migration1794283200005 implements MigrationInterface {
  name = 'Migration1794283200005'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_credit_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" character varying NOT NULL,
        "type" character varying NOT NULL,
        "amountCents" integer NOT NULL,
        "balanceAfterCents" integer NOT NULL,
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "description" character varying,
        "referenceType" character varying,
        "referenceId" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "market_credit_entries_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE INDEX "market_credit_entries_org_created_index" ON "market_credit_entries" ("organizationId", "createdAt")`,
    )
    await queryRunner.query(
      `CREATE UNIQUE INDEX "market_credit_entries_usage_unique" ON "market_credit_entries" ("organizationId", "referenceId") WHERE "referenceType" = 'market_usage'`,
    )

    await queryRunner.query(`
      CREATE TABLE "market_usage_charges" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leaseId" uuid NOT NULL,
        "listingId" uuid NOT NULL,
        "consumerOrganizationId" character varying NOT NULL,
        "providerOrganizationId" character varying NOT NULL,
        "periodStart" date NOT NULL,
        "cpuHours" double precision NOT NULL DEFAULT 0,
        "memoryGiBHours" double precision NOT NULL DEFAULT 0,
        "diskGiBHours" double precision NOT NULL DEFAULT 0,
        "gpuHours" double precision NOT NULL DEFAULT 0,
        "amountCents" integer NOT NULL DEFAULT 0,
        "platformFeeCents" integer NOT NULL DEFAULT 0,
        "providerNetCents" integer NOT NULL DEFAULT 0,
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "market_usage_charges_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "market_usage_charges_lease_period_unique" ON "market_usage_charges" ("leaseId", "periodStart")`,
    )
    await queryRunner.query(
      `CREATE INDEX "market_usage_charges_consumer_index" ON "market_usage_charges" ("consumerOrganizationId", "periodStart")`,
    )

    await queryRunner.query(`ALTER TABLE "settlement_periods" ADD "platformFeeCents" integer NOT NULL DEFAULT 0`)
    await queryRunner.query(`ALTER TABLE "settlement_periods" ADD "netCents" integer NOT NULL DEFAULT 0`)
    await queryRunner.query(
      `UPDATE "settlement_periods" SET "netCents" = "amountCents" WHERE "netCents" = 0 AND "amountCents" > 0`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "settlement_periods" DROP COLUMN "netCents"`)
    await queryRunner.query(`ALTER TABLE "settlement_periods" DROP COLUMN "platformFeeCents"`)
    await queryRunner.query(`DROP TABLE "market_usage_charges"`)
    await queryRunner.query(`DROP TABLE "market_credit_entries"`)
  }
}
