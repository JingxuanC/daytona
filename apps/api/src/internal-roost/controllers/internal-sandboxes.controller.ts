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
  UseFilters,
  UseGuards,
} from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public } from '../../auth/decorators/public.decorator'
import { RoostScopes } from '../decorators/roost-scopes.decorator'
import { CreateSandboxBody, SandboxControlResponse } from '../dto/internal-roost.dto'
import {
  PauseSandboxBody,
  ResizeSandboxBody,
  SnapshotSandboxBody,
  SnapshotSandboxResponse,
} from '../dto/sandbox-ops.dto'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostJwtGuard } from '../guards/roost-jwt.guard'
import { RoostOrgBindingGuard } from '../guards/roost-org-binding.guard'
import { RoostScopeGuard } from '../guards/roost-scope.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { RoostSandboxesService } from '../services/roost-sandboxes.service'

/**
 * Sandbox control for a market-service organization.
 *
 * The organization always comes from the JWT `org_id` claim (enforced equal to the
 * path by `RoostOrgBindingGuard`); a body `organizationId` is ignored.
 */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalSandboxesController {
  constructor(private readonly sandboxesService: RoostSandboxesService) {}

  @Post('orgs/:orgId/sandbox')
  @HttpCode(201)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async createSandbox(
    @Param('orgId') orgId: string,
    @Body() body: CreateSandboxBody,
  ): Promise<SandboxControlResponse> {
    return this.sandboxesService.createSandbox(orgId, body)
  }

  @Get('orgs/:orgId/sandbox/:sandboxId')
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async getSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
  ): Promise<SandboxControlResponse> {
    return this.sandboxesService.getSandbox(orgId, sandboxId)
  }

  @Delete('orgs/:orgId/sandbox/:sandboxId')
  @HttpCode(204)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async deleteSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
  ): Promise<void> {
    await this.sandboxesService.deleteSandbox(orgId, sandboxId)
  }

  @Post('orgs/:orgId/sandbox/:sandboxId/start')
  @HttpCode(200)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async startSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
  ): Promise<SandboxControlResponse> {
    return this.sandboxesService.startSandbox(orgId, sandboxId)
  }

  @Post('orgs/:orgId/sandbox/:sandboxId/stop')
  @HttpCode(200)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async stopSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
  ): Promise<SandboxControlResponse> {
    return this.sandboxesService.stopSandbox(orgId, sandboxId)
  }

  /** Optional M1 operation. Only STARTED VM/Windows sandboxes can be paused (fork rules). */
  @Post('orgs/:orgId/sandbox/:sandboxId/pause')
  @HttpCode(200)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async pauseSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
    @Body() body: PauseSandboxBody,
  ): Promise<SandboxControlResponse> {
    return this.sandboxesService.pauseSandbox(orgId, sandboxId, body)
  }

  /**
   * Optional M1 operation. Body fields are exactly the fork's `ResizeSandboxDto`
   * (cpu/memory/disk); unsupported fields are rejected with 400.
   */
  @Post('orgs/:orgId/sandbox/:sandboxId/resize')
  @HttpCode(200)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async resizeSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
    @Body() body: ResizeSandboxBody,
  ): Promise<SandboxControlResponse> {
    return this.sandboxesService.resizeSandbox(orgId, sandboxId, body)
  }

  /**
   * Optional M1 operation. Body fields are the fork's `CreateSandboxSnapshotDto`
   * (name + includeMemory); unsupported fields are rejected with 400.
   */
  @Post('orgs/:orgId/sandbox/:sandboxId/snapshot')
  @HttpCode(200)
  @UseGuards(RoostJwtGuard, RoostOrgBindingGuard, RoostScopeGuard)
  @RoostScopes(RoostScope.SANDBOX_CONTROL)
  async snapshotSandbox(
    @Param('orgId') orgId: string,
    @Param('sandboxId') sandboxId: string,
    @Body() body: SnapshotSandboxBody,
  ): Promise<SnapshotSandboxResponse> {
    return this.sandboxesService.snapshotSandbox(orgId, sandboxId, body)
  }
}
