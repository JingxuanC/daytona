/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Body, Controller, HttpCode, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Request } from 'express'
import { Public } from '../../auth/decorators/public.decorator'
import { IssueCredentialBody, RevokeCredentialBody } from '../dto/credentials.dto'
import { RoostExceptionsFilter } from '../filters/roost-exceptions.filter'
import { RoostMtlsGuard } from '../guards/roost-mtls.guard'
import { INTERNAL_ROOST_PATH } from '../internal-roost.constants'
import { getRoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostCredentialsService } from '../services/roost-credentials.service'

/**
 * mTLS-authenticated credential minting for the Roost market service.
 *
 * This is the only internal endpoint that is NOT authorized with a JWT: the mTLS
 * client certificate is the caller identity and becomes the JWT `sub` claim.
 */
@ApiExcludeController()
@Public()
@UseFilters(RoostExceptionsFilter)
@Controller(INTERNAL_ROOST_PATH)
export class InternalCredentialsController {
  constructor(private readonly credentialsService: RoostCredentialsService) {}

  @Post('credentials')
  @HttpCode(201)
  @UseGuards(RoostMtlsGuard)
  issueCredential(@Req() request: Request, @Body() body: IssueCredentialBody) {
    const subject = getRoostInternalRequest(request).roostMtls?.subject ?? 'unknown'
    return this.credentialsService.issueCredential(body, subject)
  }

  @Post('credentials/:jti/revoke')
  @HttpCode(204)
  @UseGuards(RoostMtlsGuard)
  async revokeCredential(
    @Param('jti') jti: string,
    @Body() body: RevokeCredentialBody,
  ): Promise<void> {
    await this.credentialsService.revokeCredential(jti, body ?? {})
  }
}
