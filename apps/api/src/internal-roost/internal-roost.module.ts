/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { OrganizationModule } from '../organization/organization.module'
import { RegionModule } from '../region/region.module'
import { SandboxModule } from '../sandbox/sandbox.module'
import { RegionQuota } from '../organization/entities/region-quota.entity'
import { Sandbox } from '../sandbox/entities/sandbox.entity'
import { SandboxUsagePeriod } from '../usage/entities/sandbox-usage-period.entity'
import { InternalCapacityController } from './controllers/internal-capacity.controller'
import { InternalDataPlaneController } from './controllers/internal-data-plane.controller'
import { InternalCredentialsController } from './controllers/internal-credentials.controller'
import { InternalQuotasController } from './controllers/internal-quotas.controller'
import { InternalSandboxesController } from './controllers/internal-sandboxes.controller'
import { InternalTenantsController } from './controllers/internal-tenants.controller'
import { InternalUsageController } from './controllers/internal-usage.controller'
import { RegionQuotaSource } from './entities/region-quota-source.entity'
import { RoostRevokedCredential } from './entities/roost-revoked-credential.entity'
import { RoostTenantMapping } from './entities/roost-tenant-mapping.entity'
import { RoostDataPlaneGuard } from './guards/roost-data-plane.guard'
import { RoostJwtGuard } from './guards/roost-jwt.guard'
import { RoostMtlsGuard } from './guards/roost-mtls.guard'
import { RoostOrgBindingGuard } from './guards/roost-org-binding.guard'
import { RoostScopeGuard } from './guards/roost-scope.guard'
import { InternalRoostServerService } from './internal-roost.server.service'
import { RoostCredentialsService } from './services/roost-credentials.service'
import { RoostDataPlaneProxyService } from './services/roost-data-plane-proxy.service'
import { RoostDataPlaneService } from './services/roost-data-plane.service'
import { RoostKeyService } from './services/roost-key.service'
import { RoostQuotasService } from './services/roost-quotas.service'
import { RoostRegionsService } from './services/roost-regions.service'
import { RoostRunnersService } from './services/roost-runners.service'
import { RoostSandboxesService } from './services/roost-sandboxes.service'
import { RoostTenantsService } from './services/roost-tenants.service'
import { RoostUsageService } from './services/roost-usage.service'

/**
 * Fork-side internal control plane for the Roost market service.
 *
 * Everything here is intentionally isolated from the public `/api` surface:
 * - routes live under `/internal/roost/v1` (global `api` prefix excluded) and are
 *   only reachable through the dedicated internal listener,
 * - mTLS is the root of trust; short-lived Ed25519 JWTs carry org/sandbox/scope,
 * - no market-service code is imported or duplicated (AGPL isolation).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoostTenantMapping,
      RoostRevokedCredential,
      RegionQuotaSource,
      RegionQuota,
      Sandbox,
      SandboxUsagePeriod,
    ]),
    OrganizationModule,
    RegionModule,
    SandboxModule,
  ],
  controllers: [
    InternalCredentialsController,
    InternalTenantsController,
    InternalCapacityController,
    InternalQuotasController,
    InternalSandboxesController,
    InternalUsageController,
    InternalDataPlaneController,
  ],
  providers: [
    InternalRoostServerService,
    RoostKeyService,
    RoostCredentialsService,
    RoostTenantsService,
    RoostRegionsService,
    RoostRunnersService,
    RoostQuotasService,
    RoostSandboxesService,
    RoostUsageService,
    RoostDataPlaneService,
    RoostDataPlaneProxyService,
    RoostMtlsGuard,
    RoostJwtGuard,
    RoostOrgBindingGuard,
    RoostScopeGuard,
    RoostDataPlaneGuard,
  ],
  exports: [InternalRoostServerService, RoostCredentialsService, RoostDataPlaneGuard, RoostMtlsGuard],
})
export class InternalRoostModule {}
