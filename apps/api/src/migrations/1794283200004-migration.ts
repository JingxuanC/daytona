/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Compute market M1:
 * - market_listings: provider organization sells capacity of one of its own regions
 * - market_leases: consumer organization's entitlement, with a price snapshot
 */
export class Migration1794283200004 implements MigrationInterface {
  name = 'Migration1794283200004'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "market_listings_visibility_enum" AS ENUM ('public', 'private')`)
    await queryRunner.query(
      `CREATE TYPE "market_listings_status_enum" AS ENUM ('draft', 'pending_approval', 'published', 'paused', 'retired')`,
    )
    await queryRunner.query(`CREATE TYPE "market_leases_status_enum" AS ENUM ('active', 'closed')`)

    await queryRunner.query(`
      CREATE TABLE "market_listings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "providerOrganizationId" character varying NOT NULL,
        "regionId" character varying NOT NULL,
        "name" character varying NOT NULL,
        "description" text,
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "cpuHourCents" integer NOT NULL DEFAULT 0,
        "memoryGiBHourCents" integer NOT NULL DEFAULT 0,
        "diskGiBHourCents" integer NOT NULL DEFAULT 0,
        "gpuHourCents" integer NOT NULL DEFAULT 0,
        "totalCpu" integer NOT NULL,
        "totalMemoryGiB" integer NOT NULL,
        "totalDiskGiB" integer NOT NULL,
        "maxCpuPerSandbox" integer NOT NULL DEFAULT 10,
        "maxMemoryPerSandbox" integer NOT NULL DEFAULT 16,
        "maxDiskPerSandbox" integer NOT NULL DEFAULT 100,
        "maxSandboxes" integer NOT NULL DEFAULT 10,
        "visibility" "market_listings_visibility_enum" NOT NULL DEFAULT 'public',
        "status" "market_listings_status_enum" NOT NULL DEFAULT 'published',
        "platformFeeBps" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "market_listings_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "market_listings_provider_region_unique" ON "market_listings" ("providerOrganizationId", "regionId")`,
    )
    await queryRunner.query(`CREATE INDEX "market_listings_status_index" ON "market_listings" ("status")`)

    await queryRunner.query(`
      CREATE TABLE "market_leases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "listingId" uuid NOT NULL,
        "consumerOrganizationId" character varying NOT NULL,
        "status" "market_leases_status_enum" NOT NULL DEFAULT 'active',
        "currency" character varying NOT NULL DEFAULT 'CNY',
        "cpuHourCents" integer NOT NULL DEFAULT 0,
        "memoryGiBHourCents" integer NOT NULL DEFAULT 0,
        "diskGiBHourCents" integer NOT NULL DEFAULT 0,
        "gpuHourCents" integer NOT NULL DEFAULT 0,
        "totalCpu" integer NOT NULL,
        "totalMemoryGiB" integer NOT NULL,
        "totalDiskGiB" integer NOT NULL,
        "maxCpuPerSandbox" integer NOT NULL DEFAULT 10,
        "maxMemoryPerSandbox" integer NOT NULL DEFAULT 16,
        "maxDiskPerSandbox" integer NOT NULL DEFAULT 100,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "closedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "market_leases_id_pk" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "market_leases_active_unique" ON "market_leases" ("consumerOrganizationId", "listingId") WHERE "status" = 'active'`,
    )
    await queryRunner.query(
      `CREATE INDEX "market_leases_listing_status_index" ON "market_leases" ("listingId", "status")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "market_leases"`)
    await queryRunner.query(`DROP TABLE "market_listings"`)
    await queryRunner.query(`DROP TYPE "market_leases_status_enum"`)
    await queryRunner.query(`DROP TYPE "market_listings_status_enum"`)
    await queryRunner.query(`DROP TYPE "market_listings_visibility_enum"`)
  }
}
