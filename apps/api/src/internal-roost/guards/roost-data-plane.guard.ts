/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RoostJwtError } from '../jwt/ed25519-jwt.util'
import { RoostAudience } from '../enums/roost-audience.enum'
import { ROOST_METADATA_SCOPES_KEY } from '../internal-roost.constants'
import { getRoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostCredentialsService } from '../services/roost-credentials.service'
import { assertInternalRoostListener, extractBearerToken } from './roost-request.util'

/**
 * Data-plane credential guard (`aud=daytona-data`) for toolbox/preview proxying.
 *
 * Enforces exactly the constraints from the internal contract:
 * - valid, unrevoked Ed25519 credential
 * - audience is `daytona-data`
 * - credential is bound to exactly one sandbox and that `sandbox_id` equals the
 *   `:sandboxId` path parameter
 * - optional required scopes (`toolbox`, `preview`) declared with `@RoostScopes(...)`
 *
 * The guard is exported from `InternalRoostModule` so the toolbox/preview proxying
 * code (M3) can mount it with:
 *
 * ```ts
 * @UseGuards(RoostMtlsGuard, RoostDataPlaneGuard)
 * @RoostScopes(RoostScope.TOOLBOX)
 * @Get('internal/roost/v1/sandboxes/:sandboxId/toolbox/{*path}')
 * ```
 */
@Injectable()
export class RoostDataPlaneGuard implements CanActivate {
  constructor(
    private readonly credentialsService: RoostCredentialsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRoostInternalRequest(context.switchToHttp().getRequest())
    assertInternalRoostListener(request)

    const token = extractBearerToken(request)
    if (!token) {
      throw new UnauthorizedException('Missing Authorization bearer credential')
    }

    let claims
    try {
      claims = this.credentialsService.verifyDataToken(token)
    } catch (error) {
      if (error instanceof RoostJwtError) {
        throw new UnauthorizedException(`Invalid credential: ${error.message}`)
      }
      throw error
    }

    if (claims.aud !== RoostAudience.DATA) {
      throw new ForbiddenException('Credential audience is not daytona-data')
    }

    if (!claims.sandbox_id || claims.sandbox_id.length === 0) {
      throw new ForbiddenException('Data-plane credential is not bound to a sandbox')
    }

    const sandboxId = request.params?.sandboxId as string | undefined
    if (!sandboxId || sandboxId !== claims.sandbox_id) {
      throw new ForbiddenException('Credential sandbox_id does not match the sandbox in the request path')
    }

    await this.credentialsService.assertNotRevoked(claims.jti)

    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(ROOST_METADATA_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    const missingScopes = requiredScopes.filter((scope) => !claims.scope.includes(scope))
    if (missingScopes.length > 0) {
      throw new ForbiddenException({
        message: `Missing required data-plane scope(s): ${missingScopes.join(', ')}`,
        details: { missing_scopes: missingScopes },
      })
    }

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
