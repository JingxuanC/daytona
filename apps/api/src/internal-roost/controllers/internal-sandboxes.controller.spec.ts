/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROOST_METADATA_SCOPES_KEY } from '../internal-roost.constants'
import { RoostScope } from '../enums/roost-scope.enum'
import { RoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostScopeGuard } from '../guards/roost-scope.guard'
import { InternalSandboxesController } from './internal-sandboxes.controller'

const OPTIONAL_OPERATIONS = ['pauseSandbox', 'resizeSandbox', 'snapshotSandbox'] as const

function buildContext(
  handler: (...args: any[]) => any,
  scope: string[] = [RoostScope.SANDBOX_CONTROL],
): ExecutionContext {
  const request = {
    roostInternalListener: true,
    params: { orgId: 'org-1', sandboxId: 'sbx-1' },
    headers: {},
    roostAuth: {
      aud: 'daytona-control',
      orgId: 'org-1',
      sandboxId: null,
      scope,
      jti: 'jti-1',
      subject: 'CN=market-api',
      claims: {
        iss: 'daytona',
        aud: 'daytona-control',
        sub: 'CN=market-api',
        org_id: 'org-1',
        sandbox_id: null,
        scope,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: 'jti-1',
      },
    },
  } as unknown as RoostInternalRequest

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => InternalSandboxesController,
  } as unknown as ExecutionContext
}

describe('InternalSandboxesController optional M1 operations', () => {
  it.each(OPTIONAL_OPERATIONS)('%s requires the sandbox:control scope', (methodName) => {
    const handler = InternalSandboxesController.prototype[methodName]
    const scopes = Reflect.getMetadata(ROOST_METADATA_SCOPES_KEY, handler)
    expect(scopes).toEqual([RoostScope.SANDBOX_CONTROL])
  })

  it.each(OPTIONAL_OPERATIONS)('rejects a credential without sandbox:control on %s (403)', (methodName) => {
    const guard = new RoostScopeGuard(new Reflector())
    const context = buildContext(InternalSandboxesController.prototype[methodName], [RoostScope.USAGE_READ])

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })

  it.each(OPTIONAL_OPERATIONS)('allows a sandbox:control credential on %s', (methodName) => {
    const guard = new RoostScopeGuard(new Reflector())
    const context = buildContext(InternalSandboxesController.prototype[methodName])

    expect(guard.canActivate(context)).toBe(true)
  })
})
