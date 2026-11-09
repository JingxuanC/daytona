/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Compute market M4 (market mechanisms):
 * - market_bids: consumer price bids accepted/rejected by providers
 * - market_sla_events: daily SLA breach compensation records
 * - market_listings: SLA availability target + compensation basis points
 */
export class Migration1794283200007 implements MigrationInterface {
  name = 'Migration1794283200007'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "market_listings" ADD "slaAvailabilityPct" integer NOT NULL DEFAULT 99`)
    await queryRunner.query(`ALTER TABLE "market_listings" ADD "slaCompensationBps" integer NOT NULL DEFAULT 500`)

    await queryRunner.query(`
      CREATE TABLE "market_bids" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "listingId" uuid NOT NULL,
        "consumerOrganizationId" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "cpuHourCents" integer NOT NULL DEFAULT 0,
        "memoryGiBHourCents" integer NOT NULL DEFAULT 0,
        "diskGiBHourCents" integer NOT NULL DEFAULT 0,
        "gpuHourCents" integer NOT NULL DEFAULT 0,
        "totalCpu" integer NOT NULL,
        "totalMemoryGiB" integer NOT NULL,
        "totalDiskGiB" integer NOT NULL,
        "message" character varying,
        "leaseId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "market_bids_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "market_bids_pending_unique" ON "market_bids" ("consumerOrganizationId", "listingId") WHERE "status" = 'pending'`,
    )
    await queryRunner.query(`CREATE INDEX "market_bids_listing_status_index" ON "market_bids" ("listingId", "status")`)

    await queryRunner.query(`
      CREATE TABLE "market_sla_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "chargeId" uuid NOT NULL,
        "leaseId" uuid NOT NULL,
        "consumerOrganizationId" character varying NOT NULL,
        "providerOrganizationId" character varying NOT NULL,
        "periodStart" date NOT NULL,
        "availabilityPct" double precision NOT NULL DEFAULT 0,
        "requiredAvailabilityPct" integer NOT NULL,
        "compensationCents" integer NOT NULL DEFAULT 0,
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "reason" text NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "market_sla_events_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX "market_sla_events_charge_unique" ON "market_sla_events" ("chargeId")`)
    await queryRunner.query(
      `CREATE INDEX "market_sla_events_consumer_index" ON "market_sla_events" ("consumerOrganizationId", "periodStart")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "market_sla_events"`)
    await queryRunner.query(`DROP TABLE "market_bids"`)
    await queryRunner.query(`ALTER TABLE "market_listings" DROP COLUMN "slaCompensationBps"`)
    await queryRunner.query(`ALTER TABLE "market_listings" DROP COLUMN "slaAvailabilityPct"`)
  }
}
