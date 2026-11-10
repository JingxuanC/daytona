/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, HttpCode, Post, UseFilters, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public } from '../../auth/decorators/public.decorator'
import { RoostScopes } from '../decorators/roost-scopes.decorator'
import { ProvisionTenantBody } from '../dto/internal-roost.dto'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostJwtGuard } from '../guards/roost-jwt.guard'
import { RoostScopeGuard } from '../guards/roost-scope.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { RoostTenantsService } from '../services/roost-tenants.service'

/**
 * Idempotent tenant (organization) provisioning.
 *
 * Only a control credential carrying exactly `tenant:provision` can call this route;
 * such a credential has no `org_id` and cannot be used for any other operation.
 */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalTenantsController {
  constructor(private readonly tenantsService: RoostTenantsService) {}

  @Post('tenants')
  @HttpCode(201)
  @UseGuards(RoostJwtGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.TENANT_PROVISION)
  async provisionTenant(@Body() body: ProvisionTenantBody) {
    const result = await this.tenantsService.provision(body)
    return { organization_id: result.organization_id, state: result.state }
  }
}
