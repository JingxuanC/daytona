/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { RoostOrgBindingGuard } from './roost-org-binding.guard'
import { RoostInternalRequest } from '../interfaces/roost-request.interface'

function buildContext(request: RoostInternalRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() { return undefined },
    getClass: () => class Test {},
  } as unknown as ExecutionContext
}

function buildRequest(params: Record<string, string>, orgId: string | null, listener = true): RoostInternalRequest {
  const claims = {
    iss: 'daytona',
    aud: 'daytona-control',
    sub: 'CN=market-api',
    org_id: orgId,
    sandbox_id: null,
    scope: ['sandbox:control'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    jti: 'jti-1',
  }
  const request = {
    roostInternalListener: listener,
    params,
    headers: {},
  } as unknown as RoostInternalRequest
  request.roostAuth = {
    aud: 'daytona-control',
    orgId,
    sandboxId: null,
    scope: claims.scope,
    jti: claims.jti,
    subject: claims.sub,
    claims,
  }
  return request
}

describe('RoostOrgBindingGuard', () => {
  it('allows the organization from the credential', () => {
    const guard = new RoostOrgBindingGuard()
    expect(guard.canActivate(buildContext(buildRequest({ orgId: 'org-1' }, 'org-1')))).toBe(true)
  })

  it('rejects a path organization that does not match the credential', () => {
    const guard = new RoostOrgBindingGuard()
    expect(() => guard.canActivate(buildContext(buildRequest({ orgId: 'org-2' }, 'org-1')))).toThrow(
      ForbiddenException,
    )
  })

  it('rejects a credential not bound to an organization on an organization route', () => {
    const guard = new RoostOrgBindingGuard()
    expect(() =>
      guard.canActivate(buildContext(buildRequest({ orgId: 'org-1' }, null))),
    ).toThrow(ForbiddenException)
  })

  it('allows routes without an orgId path parameter', () => {
    const guard = new RoostOrgBindingGuard()
    expect(guard.canActivate(buildContext(buildRequest({ regionId: 'region-1' }, 'org-1')))).toBe(true)
  })

  it('rejects requests that did not arrive on the internal listener', () => {
    const guard = new RoostOrgBindingGuard()
    expect(() => guard.canActivate(buildContext(buildRequest({}, 'org-1', false)))).toThrow(UnauthorizedException)
  })
})
