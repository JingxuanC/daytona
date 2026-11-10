/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROOST_METADATA_SCOPES_KEY } from '../internal-roost.constants'
import { RoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostScopeGuard } from './roost-scope.guard'

function buildRequest(overrides: Partial<RoostInternalRequest> = {}): RoostInternalRequest {
  return {
    roostInternalListener: true,
    headers: {},
    params: {},
    ...overrides,
  } as unknown as RoostInternalRequest
}

function buildContext(request: RoostInternalRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() { return undefined },
    getClass: () => class Test {},
  } as unknown as ExecutionContext
}

function buildReflector(requiredScopes: string[]): Reflector {
  return {
    getAllAndOverride: (key: string) => (key === ROOST_METADATA_SCOPES_KEY ? requiredScopes : undefined),
  } as unknown as Reflector
}

function attachAuth(request: RoostInternalRequest, scope: string[], orgId: string | null = 'org-1'): void {
  request.roostAuth = {
    aud: 'daytona-control',
    orgId,
    sandboxId: null,
    scope,
    jti: 'jti-1',
    subject: 'CN=market-api',
    claims: {
      iss: 'daytona',
      aud: 'daytona-control',
      sub: 'CN=market-api',
      org_id: orgId,
      sandbox_id: null,
      scope,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: 'jti-1',
    },
  }
}

describe('RoostScopeGuard', () => {
  it('rejects a credential that crosses scopes', () => {
    const request = buildRequest()
    attachAuth(request, ['tenant:provision'], null)
    const guard = new RoostScopeGuard(buildReflector(['sandbox:control']))

    expect(() => guard.canActivate(buildContext(request))).toThrow(ForbiddenException)
    try {
      guard.canActivate(buildContext(request))
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        details: { missing_scopes: ['sandbox:control'] },
      })
    }
  })

  it('allows a credential carrying the required scope', () => {
    const request = buildRequest()
    attachAuth(request, ['sandbox:control', 'usage:read'])
    const guard = new RoostScopeGuard(buildReflector(['sandbox:control']))

    expect(guard.canActivate(buildContext(request))).toBe(true)
  })

  it('allows routes without a scope requirement', () => {
    const request = buildRequest()
    attachAuth(request, ['usage:read'])
    const guard = new RoostScopeGuard(buildReflector([]))

    expect(guard.canActivate(buildContext(request))).toBe(true)
  })

  it('rejects requests without a control credential', () => {
    const guard = new RoostScopeGuard(buildReflector(['usage:read']))
    expect(() => guard.canActivate(buildContext(buildRequest()))).toThrow(UnauthorizedException)
  })

  it('rejects requests that did not arrive on the internal listener', () => {
    const request = buildRequest({ roostInternalListener: false })
    attachAuth(request, ['usage:read'])
    const guard = new RoostScopeGuard(buildReflector(['usage:read']))

    expect(() => guard.canActivate(buildContext(request))).toThrow(UnauthorizedException)
  })
})
