/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { RoostMtlsGuard } from './roost-mtls.guard'

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

function buildContext(socket: Record<string, unknown>, listener = true): ExecutionContext {
  const request = { roostInternalListener: listener, socket }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() { return undefined },
    getClass: () => class Test {},
  } as unknown as ExecutionContext
}

describe('RoostMtlsGuard', () => {
  it('allows loopback callers in the development no-CA fallback', () => {
    const guard = new RoostMtlsGuard(createConfigService())
    const context = buildContext({ remoteAddress: '127.0.0.1' })

    expect(guard.canActivate(context)).toBe(true)
    expect((context.switchToHttp().getRequest() as any).roostMtls.subject).toBe('dev-loopback')
  })

  it('rejects non-loopback callers in the development no-CA fallback', () => {
    const guard = new RoostMtlsGuard(createConfigService())
    expect(() => guard.canActivate(buildContext({ remoteAddress: '10.1.2.3' }))).toThrow(ForbiddenException)
  })

  it('refuses mTLS-less access in production', () => {
    const guard = new RoostMtlsGuard(createConfigService({ production: true }))
    expect(() => guard.canActivate(buildContext({ remoteAddress: '127.0.0.1' }))).toThrow(
      ServiceUnavailableException,
    )
  })

  it('accepts an authorized client certificate with an allow-listed CN', () => {
    const guard = new RoostMtlsGuard(
      createConfigService({
        'internalRoost.tls.caPath': '/tmp/ca.pem',
        'internalRoost.tls.clientCnAllowlist': ['market-api'],
      }),
    )
    const context = buildContext({
      authorized: true,
      getPeerCertificate: () => ({ subject: { CN: 'market-api' }, fingerprint256: 'AA:BB' }),
    })

    expect(guard.canActivate(context)).toBe(true)
    const request = context.switchToHttp().getRequest() as any
    expect(request.roostMtls.subject).toBe('CN=market-api')
    expect(request.roostMtls.fingerprint).toBe('AA:BB')
  })

  it('rejects an authorized client certificate whose CN is not allow-listed', () => {
    const guard = new RoostMtlsGuard(
      createConfigService({
        'internalRoost.tls.caPath': '/tmp/ca.pem',
        'internalRoost.tls.clientCnAllowlist': ['market-api'],
      }),
    )
    expect(() =>
      guard.canActivate(
        buildContext({ authorized: true, getPeerCertificate: () => ({ subject: { CN: 'unknown' } }) }),
      ),
    ).toThrow(ForbiddenException)
  })

  it('rejects an unauthorized client certificate', () => {
    const guard = new RoostMtlsGuard(createConfigService({ 'internalRoost.tls.caPath': '/tmp/ca.pem' }))
    expect(() =>
      guard.canActivate(buildContext({ authorized: false, getPeerCertificate: () => ({}) })),
    ).toThrow(UnauthorizedException)
  })

  it('rejects requests that did not arrive on the internal listener', () => {
    const guard = new RoostMtlsGuard(createConfigService())
    expect(() => guard.canActivate(buildContext({ remoteAddress: '127.0.0.1' }, false))).toThrow(
      UnauthorizedException,
    )
  })
})
