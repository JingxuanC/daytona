/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RoostKeyService } from '../services/roost-key.service'
import { RoostCredentialsService } from '../services/roost-credentials.service'
import { RoostRevokedCredential } from '../entities/roost-revoked-credential.entity'
import { ROOST_METADATA_SCOPES_KEY } from '../internal-roost.constants'
import { RoostInternalRequest } from '../interfaces/roost-request.interface'
import { RoostDataPlaneGuard } from './roost-data-plane.guard'

function setConfigPath(target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] = current[parts[index]] ?? {}
    current = current[parts[index]]
  }
  current[parts[parts.length - 1]] = value
}

export function createConfigService(overrides: Record<string, unknown> = {}): any {
  const values: Record<string, any> = {
    production: false,
    internalRoost: {
      enabled: true,
      port: 3101,
      host: '127.0.0.1',
      allowNonLoopback: false,
      tls: { certPath: undefined, keyPath: undefined, caPath: undefined, clientCnAllowlist: [] },
      jwt: {
        issuer: 'daytona',
        privateKeyPath: undefined,
        publicKeyPath: undefined,
        privateKeyPem: undefined,
        publicKeyPem: undefined,
      },
    },
  }
  for (const [path, value] of Object.entries(overrides)) {
    setConfigPath(values, path, value)
  }
  return {
    get: (key: string) => key.split('.').reduce<any>((current, part) => current?.[part], values),
  }
}

function createRevocationRepository(): any {
  const rows = new Map<string, RoostRevokedCredential>()
  return {
    rows,
    findOne: async ({ where }: any) => rows.get(where.jti) ?? null,
    save: async (row: RoostRevokedCredential) => {
      rows.set(row.jti, row)
      return row
    },
    delete: async () => ({ affected: 0 }),
  }
}

function setup(requiredScopes: string[]) {
  const config = createConfigService()
  const keyService = new RoostKeyService(config)
  keyService.onModuleInit()
  const credentialsService = new RoostCredentialsService(keyService, config, createRevocationRepository())
  const reflector = {
    getAllAndOverride: (key: string) => (key === ROOST_METADATA_SCOPES_KEY ? requiredScopes : undefined),
  } as unknown as Reflector
  const guard = new RoostDataPlaneGuard(credentialsService, reflector)
  return { guard, credentialsService }
}

function buildContext(request: RoostInternalRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() { return undefined },
    getClass: () => class Test {},
  } as unknown as ExecutionContext
}

function buildRequest(token: string, sandboxId: string, overrides: Partial<RoostInternalRequest> = {}): RoostInternalRequest {
  return {
    roostInternalListener: true,
    headers: { authorization: `Bearer ${token}` },
    params: { sandboxId },
    ...overrides,
  } as unknown as RoostInternalRequest
}

describe('RoostDataPlaneGuard', () => {
  it('accepts a data credential bound to the sandbox in the path', async () => {
    const { guard, credentialsService } = setup(['toolbox'])
    const issued = credentialsService.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['toolbox'] },
      'CN=market-api',
    )

    await expect(guard.canActivate(buildContext(buildRequest(issued.token, 'sbx-1')))).resolves.toBe(true)
  })

  it('rejects a data credential for another sandbox', async () => {
    const { guard, credentialsService } = setup(['toolbox'])
    const issued = credentialsService.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['toolbox'] },
      'CN=market-api',
    )

    await expect(guard.canActivate(buildContext(buildRequest(issued.token, 'sbx-2')))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('rejects a control credential on the data plane', async () => {
    const { guard, credentialsService } = setup(['toolbox'])
    const issued = credentialsService.issueCredential(
      { aud: 'daytona-control', org_id: 'org-1', scope: ['sandbox:control'] },
      'CN=market-api',
    )

    await expect(guard.canActivate(buildContext(buildRequest(issued.token, 'sbx-1')))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('rejects a data credential without the required scope', async () => {
    const { guard, credentialsService } = setup(['toolbox'])
    const issued = credentialsService.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['preview'] },
      'CN=market-api',
    )

    await expect(guard.canActivate(buildContext(buildRequest(issued.token, 'sbx-1')))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('rejects a revoked data credential', async () => {
    const { guard, credentialsService } = setup(['toolbox'])
    const issued = credentialsService.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['toolbox'] },
      'CN=market-api',
    )
    await credentialsService.revokeCredential(issued.jti, { token: issued.token })

    await expect(guard.canActivate(buildContext(buildRequest(issued.token, 'sbx-1')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('rejects requests without a bearer credential', async () => {
    const { guard } = setup(['toolbox'])
    const request = { roostInternalListener: true, headers: {}, params: { sandboxId: 'sbx-1' } } as unknown as RoostInternalRequest
    await expect(guard.canActivate(buildContext(request))).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects requests without a sandbox in the path', async () => {
    const { guard, credentialsService } = setup([])
    const issued = credentialsService.issueCredential(
      { aud: 'daytona-data', org_id: 'org-1', sandbox_id: 'sbx-1', scope: ['toolbox'] },
      'CN=market-api',
    )
    const request = {
      roostInternalListener: true,
      headers: { authorization: `Bearer ${issued.token}` },
      params: {},
    } as unknown as RoostInternalRequest

    await expect(guard.canActivate(buildContext(request))).rejects.toBeInstanceOf(ForbiddenException)
  })
})
