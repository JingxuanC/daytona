/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, Delete, HttpCode, Param, Put, Query, UseFilters, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public } from '../../auth/decorators/public.decorator'
import { RoostScopes } from '../decorators/roost-scopes.decorator'
import { PutRegionQuotaBody } from '../dto/internal-roost.dto'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostJwtGuard } from '../guards/roost-jwt.guard'
import { RoostOrgBindingGuard } from '../guards/roost-org-binding.guard'
import { RoostScopeGuard } from '../guards/roost-scope.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { RoostQuotasService } from '../services/roost-quotas.service'

/**
 * Per-source quota delivery.
 *
 * PUT is idempotent per `(orgId, regionId, sandbox_class, source)` and re-materializes
 * the aggregate `region_quota` row that existing sandbox quota enforcement reads.
 * DELETE removes one source; when the last source is gone the region becomes
 * invisible to the organization again.
 */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalQuotasController {
  constructor(private readonly quotasService: RoostQuotasService) {}

  @Put('orgs/:orgId/regions/:regionId/quota')
  @HttpCode(204)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.QUOTA_WRITE)
  async putQuota(
    @Param('orgId') orgId: string,
    @Param('regionId') regionId: string,
    @Body() body: PutRegionQuotaBody,
  ): Promise<void> {
    await this.quotasService.putQuota(orgId, regionId, body)
  }

  @Delete('orgs/:orgId/regions/:regionId/quota')
  @HttpCode(204)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.QUOTA_WRITE)
  async deleteQuota(
    @Param('orgId') orgId: string,
    @Param('regionId') regionId: string,
    @Query('source') source: string,
    @Query('sandbox_class') sandboxClass?: string,
  ): Promise<void> {
    await this.quotasService.deleteQuota(orgId, regionId, source, sandboxClass)
  }
}
