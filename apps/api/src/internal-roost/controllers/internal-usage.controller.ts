/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Controller, Get, Param, Query, UseFilters, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public } from '../../auth/decorators/public.decorator'
import { RoostScopes } from '../decorators/roost-scopes.decorator'
import { UsagePage } from '../dto/internal-roost.dto'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostJwtGuard } from '../guards/roost-jwt.guard'
import { RoostOrgBindingGuard } from '../guards/roost-org-binding.guard'
import { RoostScopeGuard } from '../guards/roost-scope.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { RoostUsageService } from '../services/roost-usage.service'

/** Integer-second usage read for the market service. No money is computed here. */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalUsageController {
  constructor(private readonly usageService: RoostUsageService) {}

  @Get('orgs/:orgId/usage')
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.USAGE_READ)
  async getUsage(
    @Param('orgId') orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('group_by') groupBy?: string,
  ): Promise<UsagePage> {
    return this.usageService.getUsage(orgId, from, to, groupBy)
  }
}
