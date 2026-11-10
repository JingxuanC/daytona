/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { RoostJwtError } from '../jwt/ed25519-jwt.util'
import { RoostAudience } from '../enums/roost-audience.enum'
import { getRoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostCredentialsService } from '../services/roost-credentials.service'
import { assertInternalRoostListener, extractBearerToken } from './roost-request.util'

/**
 * Validates a control-plane credential (`aud=daytona-control`) and attaches its claims
 * to the request as `roostAuth`.
 *
 * Order: JWT signature/expiry → audience → revocation list.
 */
@Injectable()
export class RoostJwtGuard implements CanActivate {
  constructor(private readonly credentialsService: RoostCredentialsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRoostInternalRequest(context.switchToHttp().getRequest())
    assertInternalRoostListener(request)

    const token = extractBearerToken(request)
    if (!token) {
      throw new UnauthorizedException('Missing Authorization bearer credential')
    }

    let claims
    try {
      claims = this.credentialsService.verifyControlToken(token)
    } catch (error) {
      if (error instanceof RoostJwtError) {
        throw new UnauthorizedException(`Invalid credential: ${error.message}`)
      }
      throw error
    }

    if (claims.aud !== RoostAudience.CONTROL) {
      throw new ForbiddenException('Credential audience is not daytona-control')
    }

    await this.credentialsService.assertNotRevoked(claims.jti)

    request.roostAuth = {
      aud: claims.aud,
      orgId: claims.org_id,
      sandboxId: claims.sandbox_id,
      scope: claims.scope,
      jti: claims.jti,
      subject: claims.sub,
      claims,
    }
    return true
  }
}
