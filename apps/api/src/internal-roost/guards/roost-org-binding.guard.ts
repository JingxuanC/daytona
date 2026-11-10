/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { getRoostAuthContext, getRoostInternalRequest } from '../interfaces/roost-request.interface'
import { assertInternalRoostListener } from './roost-request.util'

/**
 * Binds the organization in the request path to the JWT `org_id` claim.
 *
 * The organization is always taken from the credential; a request for another
 * organization is rejected before it can reach a service. `tenant:provision`
 * credentials have no `org_id` and never hit an `/orgs/{orgId}` route.
 */
@Injectable()
export class RoostOrgBindingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = getRoostInternalRequest(context.switchToHttp().getRequest())
    assertInternalRoostListener(request)

    const auth = getRoostAuthContext(request)
    const pathOrgId = request.params?.orgId as string | undefined

    if (!pathOrgId) {
      return true
    }

    if (!auth.orgId) {
      // tenant:provision credentials are deliberately not bound to an organization.
      throw new ForbiddenException('Credential is not bound to an organization')
    }

    if (auth.orgId !== pathOrgId) {
      throw new ForbiddenException('Organization in the request path does not match the credential')
    }

    return true
  }
}
