/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { RoostRevokedCredential } from '../entities/roost-revoked-credential.entity'
import { RoostJwtError } from '../jwt/ed25519-jwt.util'
import { RoostKeyService } from './roost-key.service'
import { normalizeCredentialRequest, RoostCredentialsService } from './roost-credentials.service'

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

export function createRevocationRepository(): any {
  const rows = new Map<string, RoostRevokedCredential>()
  const repository = {
    rows,
    findOne: jest.fn(async ({ where }: any) => rows.get(where.jti) ?? null),
    save: jest.fn(async (row: RoostRevokedCredential) => {
      if (rows.has(row.jti)) {
        const error = new Error('duplicate key value violates unique constraint') as Error & { code: string }
        error.code = '23505'
        throw error
      }
      rows.set(row.jti, row)
      return row
    }),
    delete: jest.fn(async () => {
      for (const [jti, row] of rows.entries()) {
        if (row.expiresAt <= new Date()) {
          rows.delete(jti)
        }
      }
      return { affected: 0 }
    }),
  }
  return repository
}

export function createCredentialsService(config: any = createConfigService()) {
  const keyService = new RoostKeyService(config)
  keyService.onModuleInit()
  const revocationRepository = createRevocationRepository()
  const service = new RoostCredentialsService(keyService, config, revocationRepository)
  return { service, keyService, revocationRepository, config }
}

describe('RoostCredentialsService', () => {
  describe('normalizeCredentialRequest', () => {
    it('maps contract snake_case fields and applies audience defaults', () => {
      const normalized = normalizeCredentialRequest({
        aud: 'daytona-control',
        org_id: 'org-1',
        scope: ['sandbox:control'],
      })
      expect(normalized).toEqual({
        aud: 'daytona-control',
        orgId: 'org-1',
        sandboxId: null,
        scope: ['sandbox:control'],
        ttlSeconds: 900,
      })
    })

    it('accepts camelCase aliases used by fork internals', () => {
      const normalized = normalizeCredentialRequest({
        aud: 'daytona-control',
        orgId: 'org-1',
        scope: 'region:write,runner:write',
        ttl: 60,
      })
      expect(normalized.orgId).toBe('org-1')
      expect(normalized.scope).toEqual(['region:write', 'runner:write'])
      expect(normalized.ttlSeconds).toBe(60)
    })

    it('rejects control credentials longer than 15 minutes', () => {
      expect(() =>
        normalizeCredentialRequest({ aud: 'daytona-control', org_id: 'org-1', scope: ['sandbox:control'], ttl_seconds: 901 }),
      ).toThrow(/must not exceed 900/)
    })

    it('rejects data credentials longer than 5 minutes', () => {
      expect(() =>
        normalizeCredentialRequest({
          aud: 'daytona-data',
          org_id: 'org-1',
          sandbox_id: 'sbx-1',
          scope: ['toolbox'],
          ttl_seconds: 301,
        }),
      ).toThrow(/must not exceed 300/)
    })

    it('requires a sandbox binding for data credentials', () => {
      expect(() =>
        normalizeCredentialRequest({ aud: 'daytona-data', org_id: 'org-1', scope: ['toolbox'] }),
      ).toThrow(/sandbox_id is required/)
    })

    it('rejects data-plane scopes on the control plane', () => {
      expect(() =>
        normalizeCredentialRequest({ aud: 'daytona-control', org_id: 'org-1', scope: ['toolbox'] }),
      ).toThrow(/require a daytona-data credential/)
    })

    it('rejects tenant:provision combined with any other scope', () => {
      expect(() =>
        normalizeCredentialRequest({
          aud: 'daytona-control',
          org_id: 'org-1',
          scope: ['tenant:provision', 'sandbox:control'],
        }),
      ).toThrow(/cannot carry any other scope/)
    })

    it('rejects tenant:provision with an org_id', () => {
      expect(() =>
        normalizeCredentialRequest({ aud: 'daytona-control', org_id: 'org-1', scope: ['tenant:provision'] }),
      ).toThrow(/must not carry an org_id/)
    })

    it('rejects unknown scopes and audiences', () => {
      expect(() =>
        normalizeCredentialRequest({ aud: 'daytona-control', org_id: 'org-1', scope: ['admin:everything'] }),
      ).toThrow(/Unknown scope/)
      expect(() => normalizeCredentialRequest({ aud: 'daytona-other', scope: ['usage:read'] })).toThrow(/aud must be one/)
    })
  })

  describe('issueCredential', () => {
    it('issues a control credential with the required claims', () => {
      const { service, keyService } = createCredentialsService()
      const issued = service.issueCredential(
        { aud: 'daytona-control', org_id: 'org-1', scope: ['sandbox:control'], ttl_seconds: 120 },
        'CN=market-api',
      )

      const claims = keyService.verify(issued.token)
      expect(claims.iss).toBe('daytona')
      expect(claims.aud).toBe('daytona-control')
      expect(claims.sub).toBe('CN=market-api')
      expect(claims.org_id).toBe('org-1')
      expect(claims.sandbox_id).toBeNull()
      expect(claims.scope).toEqual(['sandbox:control'])
      expect(claims.exp - claims.iat).toBe(120)
      expect(claims.jti).toBe(issued.jti)
      expect(issued.expires_at).toBe(new Date(claims.exp * 1000).toISOString())
    })

    it('issues tenant:provision credentials without an organization', () => {
      const { service, keyService } = createCredentialsService()
      const issued = service.issueCredential(
        { aud: 'daytona-control', scope: ['tenant:provision'] },
        'CN=market-api',
      )
      const claims = keyService.verify(issued.token)
      expect(claims.org_id).toBeNull()
      expect(claims.scope).toEqual(['tenant:provision'])
      expect(claims.exp - claims.iat).toBe(900)
    })
  })

  describe('revokeCredential', () => {
    it('stores the revocation for the remaining lifetime of the token', async () => {
      const { service, keyService, revocationRepository } = createCredentialsService()
      const issued = service.issueCredential(
        { aud: 'daytona-control', org_id: 'org-1', scope: ['usage:read'], ttl_seconds: 600 },
        'CN=market-api',
      )
      const claims = keyService.verify(issued.token)

      const result = await service.revokeCredential(issued.jti, { token: issued.token, reason: 'test' })

      expect(result.result).toBe('revoked')
      const row = revocationRepository.rows.get(issued.jti)
      expect(row.expiresAt.getTime()).toBe(claims.exp * 1000)
      expect(row.orgId).toBe('org-1')
      expect(row.aud).toBe('daytona-control')

      await expect(service.assertNotRevoked(issued.jti)).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('is idempotent for the same jti', async () => {
      const { service, revocationRepository } = createCredentialsService()
      const issued = service.issueCredential(
        { aud: 'daytona-control', org_id: 'org-1', scope: ['usage:read'] },
        'CN=market-api',
      )

      const first = await service.revokeCredential(issued.jti, { token: issued.token })
      const second = await service.revokeCredential(issued.jti, { token: issued.token })

      expect(first.result).toBe('revoked')
      expect(second.result).toBe('idempotent')
      expect(revocationRepository.save).toHaveBeenCalledTimes(1)
    })

    it('falls back to the bounded maximum lifetime when the token is not supplied', async () => {
      const { service, revocationRepository } = createCredentialsService()
      const jti = 'some-jti'

      const before = Date.now()
      const result = await service.revokeCredential(jti, {})
      const after = Date.now()

      expect(result.result).toBe('revoked')
      const row = revocationRepository.rows.get(jti)
      expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 899_000)
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(after + 901_000)
    })

    it('does not store a row for an already expired credential', async () => {
      const { service, keyService, revocationRepository } = createCredentialsService()
      const now = Math.floor(Date.now() / 1000)
      const expiredToken = keyService.sign({
        iss: 'daytona',
        aud: 'daytona-control',
        sub: 'CN=market-api',
        org_id: 'org-1',
        sandbox_id: null,
        scope: ['usage:read'],
        iat: now - 120,
        exp: now - 60,
        jti: 'expired-jti',
      })

      const result = await service.revokeCredential('expired-jti', { token: expiredToken })

      expect(result.result).toBe('expired')
      expect(revocationRepository.rows.size).toBe(0)
    })

    it('rejects a token that does not match the jti in the path', async () => {
      const { service } = createCredentialsService()
      const issued = service.issueCredential(
        { aud: 'daytona-control', org_id: 'org-1', scope: ['usage:read'] },
        'CN=market-api',
      )

      await expect(service.revokeCredential('another-jti', { token: issued.token })).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('rejects a malformed token supplied for revocation', async () => {
      const { service } = createCredentialsService()
      await expect(service.revokeCredential('jti-1', { token: 'garbage' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })
  })

  describe('verifyToken', () => {
    it('rejects a token issued by another issuer', () => {
      const { service, keyService } = createCredentialsService()
      const now = Math.floor(Date.now() / 1000)
      const foreign = keyService.sign({
        iss: 'not-daytona',
        aud: 'daytona-control',
        sub: 'CN=market-api',
        org_id: 'org-1',
        sandbox_id: null,
        scope: ['usage:read'],
        iat: now,
        exp: now + 60,
        jti: 'foreign',
      })

      expect(() => service.verifyToken(foreign)).toThrow(RoostJwtError)
    })
  })
})
