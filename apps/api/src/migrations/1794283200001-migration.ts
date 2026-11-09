/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Attribute sandbox usage periods to the runner (compute node) that served them so
 * usage can be aggregated and billed per provider node.
 */
export class Migration1794283200001 implements MigrationInterface {
  name = 'Migration1794283200001'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sandbox_usage_periods" ADD "runnerId" character varying`)
    await queryRunner.query(`ALTER TABLE "sandbox_usage_periods_archive" ADD "runnerId" character varying`)

    await queryRunner.query(
      `CREATE INDEX "sandbox_usage_periods_organization_runner_index" ON "sandbox_usage_periods" ("organizationId", "runnerId", "startAt")`,
    )
    await queryRunner.query(
      `CREATE INDEX "sandbox_usage_periods_archive_organization_runner_index" ON "sandbox_usage_periods_archive" ("organizationId", "runnerId", "startAt")`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "sandbox_usage_periods_archive_organization_runner_index"`)
    await queryRunner.query(`DROP INDEX "sandbox_usage_periods_organization_runner_index"`)
    await queryRunner.query(`ALTER TABLE "sandbox_usage_periods_archive" DROP COLUMN "runnerId"`)
    await queryRunner.query(`ALTER TABLE "sandbox_usage_periods" DROP COLUMN "runnerId"`)
  }
}
