/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { All, Controller, Req, Res, UseFilters, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { Public } from '../../auth/decorators/public.decorator'
import { RoostScopes } from '../decorators/roost-scopes.decorator'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostDataPlaneGuard } from '../guards/roost-data-plane.guard'
import { RoostMtlsGuard } from '../guards/roost-mtls.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { RoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostDataPlaneProxyService } from '../services/roost-data-plane-proxy.service'

/**
 * Internal data plane (docs/03-api-contract.md §B6) served on the internal listener.
 *
 * The market-service edge proxy exchanges its mTLS identity for an
 * `aud=daytona-data` credential bound to one sandbox, then forwards toolbox and
 * preview traffic here. `RoostDataPlaneGuard` verifies the credential, the
 * `sandbox_id`/path binding and the `toolbox`/`preview` scope before
 * `RoostDataPlaneProxyService` streams the request to the sandbox runner.
 */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalDataPlaneController {
  constructor(private readonly proxyService: RoostDataPlaneProxyService) {}

  @All('sandboxes/:sandboxId/toolbox')
  @UseGuards(RoostMtlsGuard, RoostDataPlaneGuard)
  @RoostScopes(RoostScope.TOOLBOX)
  async toolboxRoot(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.proxyService.proxy(request as RoostInternalRequest, response, 'toolbox')
  }

  @All('sandboxes/:sandboxId/toolbox/{*path}')
  @UseGuards(RoostMtlsGuard, RoostDataPlaneGuard)
  @RoostScopes(RoostScope.TOOLBOX)
  async toolbox(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.proxyService.proxy(request as RoostInternalRequest, response, 'toolbox')
  }

  @All('sandboxes/:sandboxId/preview')
  @UseGuards(RoostMtlsGuard, RoostDataPlaneGuard)
  @RoostScopes(RoostScope.PREVIEW)
  async previewRoot(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.proxyService.proxy(request as RoostInternalRequest, response, 'preview')
  }

  @All('sandboxes/:sandboxId/preview/{*path}')
  @UseGuards(RoostMtlsGuard, RoostDataPlaneGuard)
  @RoostScopes(RoostScope.PREVIEW)
  async preview(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.proxyService.proxy(request as RoostInternalRequest, response, 'preview')
  }
}
