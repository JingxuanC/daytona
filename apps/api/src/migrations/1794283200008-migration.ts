/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Internal Roost API (fork side):
 *
 * - `roost_tenant_mappings`: market-service `external_id` → Daytona organization.
 *   The unique `externalId` makes `POST /internal/roost/v1/tenants` idempotent.
 * - `roost_revoked_credentials`: short-lived credential revocation list. A row only
 *   lives for the remaining lifetime of the JWT it revokes.
 * - `region_quota_sources`: per-source quota contributions aggregated (totals summed,
 *   per-sandbox limits maxed) into the existing `region_quota` table.
 */
export class Migration1794283200008 implements MigrationInterface {
  name = 'Migration1794283200008'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roost_tenant_mappings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "externalId" character varying NOT NULL,
        "organizationId" uuid NOT NULL,
        "state" character varying NOT NULL DEFAULT 'ready',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "roost_tenant_mappings_id_pk" PRIMARY KEY ("id"),
        CONSTRAINT "roost_tenant_mappings_organizationId_fk"
          FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "roost_tenant_mappings_externalId_unique" ON "roost_tenant_mappings" ("externalId")`,
    )
    await queryRunner.query(
      `CREATE INDEX "roost_tenant_mappings_organizationId_index" ON "roost_tenant_mappings" ("organizationId")`,
    )

    await queryRunner.query(`
      CREATE TABLE "roost_revoked_credentials" (
        "jti" character varying NOT NULL,
        "aud" character varying,
        "orgId" character varying,
        "sandboxId" character varying,
        "scope" character varying,
        "reason" character varying,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "roost_revoked_credentials_jti_pk" PRIMARY KEY ("jti")
      )
    `)
    await queryRunner.query(
      `CREATE INDEX "roost_revoked_credentials_expiresAt_index" ON "roost_revoked_credentials" ("expiresAt")`,
    )

    await queryRunner.query(`
      CREATE TABLE "region_quota_sources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "regionId" character varying NOT NULL,
        "organizationId" uuid NOT NULL,
        "sandboxClass" character varying NOT NULL DEFAULT 'container',
        "source" character varying NOT NULL,
        "totalCpuQuota" integer NOT NULL DEFAULT 0,
        "totalMemoryQuota" integer NOT NULL DEFAULT 0,
        "totalDiskQuota" integer NOT NULL DEFAULT 0,
        "maxCpuPerSandbox" integer,
        "maxMemoryPerSandbox" integer,
        "maxDiskPerSandbox" integer,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "region_quota_sources_id_pk" PRIMARY KEY ("id"),
        CONSTRAINT "region_quota_sources_regionId_fk"
          FOREIGN KEY ("regionId") REFERENCES "region"("id") ON DELETE CASCADE,
        CONSTRAINT "region_quota_sources_organizationId_fk"
          FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "region_quota_sources_source_unique" ON "region_quota_sources" ("regionId", "organizationId", "sandboxClass", "source")`,
    )
    await queryRunner.query(
      `CREATE INDEX "region_quota_sources_aggregate_index" ON "region_quota_sources" ("organizationId", "regionId", "sandboxClass")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "region_quota_sources"`)
    await queryRunner.query(`DROP TABLE "roost_revoked_credentials"`)
    await queryRunner.query(`DROP TABLE "roost_tenant_mappings"`)
  }
}
