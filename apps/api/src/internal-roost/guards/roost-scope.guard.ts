/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROOST_METADATA_SCOPES_KEY } from '../internal-roost.constants'
import { getRoostAuthContext, getRoostInternalRequest } from '../interfaces/roost-request.interface'
import { assertInternalRoostListener } from './roost-request.util'

/**
 * Enforces the scopes declared with `@RoostScopes(...)` on control-plane endpoints.
 *
 * A credential minted for one operation (e.g. `tenant:provision`) is therefore
 * rejected on every other operation even though it is otherwise valid.
 */
@Injectable()
export class RoostScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = getRoostInternalRequest(context.switchToHttp().getRequest())
    assertInternalRoostListener(request)

    const auth = getRoostAuthContext(request)
    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(ROOST_METADATA_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []

    if (requiredScopes.length === 0) {
      return true
    }

    const missingScopes = requiredScopes.filter((scope) => !auth.scope.includes(scope))
    if (missingScopes.length > 0) {
      throw new ForbiddenException({
        message: `Missing required scope(s): ${missingScopes.join(', ')}`,
        details: { missing_scopes: missingScopes },
      })
    }

    return true
  }
}
