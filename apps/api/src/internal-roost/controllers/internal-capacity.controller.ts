/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Request } from 'express'
import { Public } from '../../auth/decorators/public.decorator'
import { RoostScopes } from '../decorators/roost-scopes.decorator'
import { CreateRegionBody, CreateRunnerBody } from '../dto/internal-roost.dto'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostJwtGuard } from '../guards/roost-jwt.guard'
import { RoostOrgBindingGuard } from '../guards/roost-org-binding.guard'
import { RoostScopeGuard } from '../guards/roost-scope.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { requireRoostOrgId } from '../interfaces/roost-request.interface'
import { RoostRegionsService } from '../services/roost-regions.service'
import { RoostRunnersService } from '../services/roost-runners.service'

/**
 * Provider node capacity: the node-exclusive CUSTOM region and its runner.
 *
 * `api_key` is returned exactly once from runner creation; there is intentionally no
 * endpoint that can read it again.
 */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalCapacityController {
  constructor(
    private readonly regionsService: RoostRegionsService,
    private readonly runnersService: RoostRunnersService,
  ) {}

  @Post('orgs/:orgId/regions')
  @HttpCode(201)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.REGION_WRITE)
  async createRegion(
    @Param('orgId') orgId: string,
    @Body() body: CreateRegionBody,
  ): Promise<{ region_id: string }> {
    const result = await this.regionsService.createRegion(orgId, body)
    return { region_id: result.region_id }
  }

  @Post('regions/:regionId/runners')
  @HttpCode(201)
  @UseGuards(RoostJwtGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.RUNNER_WRITE)
  async createRunner(@Param('regionId') regionId: string, @Body() body: CreateRunnerBody, @Req() request: Request) {
    return this.runnersService.createRunner(requireRoostOrgId(request), regionId, body)
  }

  @Get('runners/:runnerId')
  @UseGuards(RoostJwtGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.RUNNER_WRITE)
  async getRunner(@Param('runnerId') runnerId: string, @Req() request: Request) {
    return this.runnersService.getRunnerHeartbeat(requireRoostOrgId(request), runnerId)
  }

  @Delete('runners/:runnerId')
  @HttpCode(204)
  @UseGuards(RoostJwtGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.RUNNER_WRITE)
  async deleteRunner(@Param('runnerId') runnerId: string, @Req() request: Request): Promise<void> {
    await this.runnersService.deleteRunner(requireRoostOrgId(request), runnerId)
  }
}
