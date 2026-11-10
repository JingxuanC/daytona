/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { LessThanOrEqual, Repository } from 'typeorm'
import { TypedConfigService } from '../../config/typed-config.service'
import {
  CredentialResponse,
  IssueCredentialBody,
  NormalizedCredentialRequest,
  RevokeCredentialBody,
} from '../dto/credentials.dto'
import { RoostRevokedCredential } from '../entities/roost-revoked-credential.entity'
import { RoostAudience, ROOST_AUDIENCES } from '../enums/roost-audience.enum'
import { RoostScope, ROOST_DATA_PLANE_SCOPES, ROOST_SCOPES } from '../enums/roost-scope.enum'
import {
  ROOST_CONTROL_TTL_SECONDS,
  ROOST_DATA_TTL_SECONDS,
  ROOST_MAX_CREDENTIAL_TTL_SECONDS,
} from '../internal-roost.constants'
import { RoostJwtClaims } from '../interfaces/roost-jwt-claims.interface'
import { RoostJwtError } from '../jwt/ed25519-jwt.util'
import { RoostKeyService } from './roost-key.service'

export interface RevokeCredentialResult {
  result: 'revoked' | 'idempotent' | 'expired'
  jti: string
  /** Remaining lifetime used as the revocation row TTL. */
  expiresAt: Date | null
}

/**
 * Issues and revokes the short-lived Ed25519 credentials consumed by the Roost market
 * service.
 *
 * - Control plane (`aud=daytona-control`): max 15 minutes TTL.
 * - Data plane (`aud=daytona-data`): max 5 minutes TTL, bound to exactly one sandbox.
 * - `tenant:provision` is only ever a control credential for onboarding a new tenant,
 *   has no `org_id` and cannot be used for any other operation.
 * - Revocations are stored for the remaining lifetime of the credential only.
 */
@Injectable()
export class RoostCredentialsService {
  private readonly logger = new Logger(RoostCredentialsService.name)

  constructor(
    private readonly keyService: RoostKeyService,
    private readonly configService: TypedConfigService,
    @InjectRepository(RoostRevokedCredential)
    private readonly revocationRepository: Repository<RoostRevokedCredential>,
  ) {}

  get issuer(): string {
    return this.configService.get('internalRoost.jwt.issuer')
  }

  verifyControlToken(token: string): RoostJwtClaims {
    return this.verifyToken(token)
  }

  verifyDataToken(token: string): RoostJwtClaims {
    return this.verifyToken(token)
  }

  /** Verifies the signature/expiry and that the token was issued by this API. */
  verifyToken(token: string, nowSeconds?: number): RoostJwtClaims {
    const claims = this.keyService.verify(token, nowSeconds)
    if (claims.iss !== this.issuer) {
      throw new RoostJwtError(`Unexpected credential issuer: ${claims.iss}`, 'invalid_payload')
    }
    return claims
  }

  issueCredential(body: IssueCredentialBody, subject: string): CredentialResponse {
    const request = normalizeCredentialRequest(body)
    const nowSeconds = Math.floor(Date.now() / 1000)
    const jti = randomUUID()
    const claims: RoostJwtClaims = {
      iss: this.issuer,
      aud: request.aud,
      sub: subject || 'internal',
      org_id: request.orgId,
      sandbox_id: request.sandboxId,
      scope: request.scope,
      iat: nowSeconds,
      exp: nowSeconds + request.ttlSeconds,
      jti,
    }

    const token = this.keyService.sign(claims)
    return {
      token,
      expires_at: new Date(claims.exp * 1000).toISOString(),
      jti,
      aud: claims.aud,
    }
  }

  /**
   * Revokes a credential by `jti`.
   *
   * When the caller supplies the original `token` (or its `exp`/`expires_at`) the row
   * is kept exactly for the remaining lifetime; otherwise it is kept for the maximum
   * possible credential lifetime (bounded, never unbounded).
   */
  async revokeCredential(jti: string, body: RevokeCredentialBody = {}): Promise<RevokeCredentialResult> {
    if (!jti || jti.trim().length === 0) {
      throw new BadRequestException('jti is required')
    }

    const now = new Date()
    await this.cleanupExpiredRevocations(now)

    const existing = await this.revocationRepository.findOne({ where: { jti } })
    if (existing && existing.expiresAt > now) {
      return { result: 'idempotent', jti, expiresAt: existing.expiresAt }
    }

    const resolved = this.resolveRevocationExpiry(body, now, jti)
    if (!resolved) {
      return { result: 'expired', jti, expiresAt: null }
    }

    const row = new RoostRevokedCredential()
    row.jti = jti
    row.expiresAt = resolved.expiresAt
    row.reason = body.reason ?? null
    if (resolved.claims) {
      row.aud = resolved.claims.aud
      row.orgId = resolved.claims.org_id
      row.sandboxId = resolved.claims.sandbox_id
      row.scope = resolved.claims.scope.join(',')
    }

    try {
      await this.revocationRepository.save(row)
      return { result: 'revoked', jti, expiresAt: resolved.expiresAt }
    } catch (error) {
      if (error?.code === '23505') {
        return { result: 'idempotent', jti, expiresAt: resolved.expiresAt }
      }
      throw error
    }
  }

  /** Throws when the credential has been revoked and is still within its lifetime. */
  async assertNotRevoked(jti: string): Promise<void> {
    const revoked = await this.revocationRepository.findOne({ where: { jti } })
    if (revoked && revoked.expiresAt > new Date()) {
      throw new UnauthorizedException('Credential has been revoked')
    }
  }

  private async cleanupExpiredRevocations(now: Date): Promise<void> {
    try {
      await this.revocationRepository.delete({ expiresAt: LessThanOrEqual(now) })
    } catch (error) {
      // Cleanup is opportunistic: never fail the request because of it.
      this.logger.warn(`Failed to clean up expired Roost credential revocations: ${error?.message}`)
    }
  }

  private resolveRevocationExpiry(
    body: RevokeCredentialBody,
    now: Date,
    jti: string,
  ): { expiresAt: Date; claims?: RoostJwtClaims } | null {
    const nowSeconds = Math.floor(now.getTime() / 1000)
    const maxExpiry = new Date((nowSeconds + ROOST_MAX_CREDENTIAL_TTL_SECONDS) * 1000)

    if (body.token) {
      let claims: RoostJwtClaims
      try {
        claims = this.verifyToken(body.token, nowSeconds)
      } catch (error) {
        if (error instanceof RoostJwtError && error.reason === 'expired') {
          return null
        }
        throw new BadRequestException(`Invalid token supplied to revoke: ${(error as Error).message}`)
      }
      if (claims.jti !== jti) {
        // defensive: the path jti must match the token
        throw new BadRequestException('Token does not match the jti in the request path')
      }
      const expiresAt = new Date(claims.exp * 1000)
      if (expiresAt <= now) {
        return null
      }
      return { expiresAt, claims }
    }

    let expiresAt: Date
    if (body.exp !== undefined || body.expires_at !== undefined) {
      const exp = body.exp !== undefined ? Number(body.exp) : Date.parse(body.expires_at)
      if (!Number.isFinite(exp)) {
        throw new BadRequestException('exp/expires_at must be a valid timestamp')
      }
      expiresAt = new Date(typeof body.exp === 'number' ? exp * 1000 : exp)
    } else {
      // Conservative upper bound: never shorter than any credential that could be out there.
      expiresAt = maxExpiry
    }

    if (expiresAt <= now) {
      return null
    }
    // Clamp so a bad caller cannot keep a revocation row forever.
    if (expiresAt > maxExpiry) {
      expiresAt = maxExpiry
    }
    return { expiresAt }
  }
}

/**
 * Validates and normalizes a credential request.
 *
 * Accepted (contract) field names are snake_case; camelCase aliases are accepted for
 * the fork's internal callers. Requirements are stricter than a generic JWT mint:
 * every constraint the market service relies on is enforced here.
 */
export function normalizeCredentialRequest(body: IssueCredentialBody): NormalizedCredentialRequest {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body is required')
  }

  const aud = body.aud
  if (typeof aud !== 'string' || !ROOST_AUDIENCES.includes(aud)) {
    throw new BadRequestException(`aud must be one of: ${ROOST_AUDIENCES.join(', ')}`)
  }

  const rawScope = body.scope
  const scope = normalizeScopeList(rawScope)
  if (scope.length === 0) {
    throw new BadRequestException('scope must contain at least one scope')
  }
  const unknownScopes = scope.filter((item) => !ROOST_SCOPES.includes(item))
  if (unknownScopes.length > 0) {
    throw new BadRequestException(`Unknown scope(s): ${unknownScopes.join(', ')}`)
  }

  const orgId = normalizeOptionalString(body.org_id ?? body.orgId)
  const sandboxId = normalizeOptionalString(body.sandbox_id ?? body.sandboxId)

  const requestedTtl = body.ttl_seconds ?? body.ttl
  const defaultTtl = aud === RoostAudience.DATA ? ROOST_DATA_TTL_SECONDS : ROOST_CONTROL_TTL_SECONDS
  const maxTtl = aud === RoostAudience.DATA ? ROOST_DATA_TTL_SECONDS : ROOST_CONTROL_TTL_SECONDS
  const ttlSeconds = requestedTtl === undefined ? defaultTtl : Number(requestedTtl)

  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new BadRequestException('ttl_seconds must be a positive integer')
  }
  if (ttlSeconds > maxTtl) {
    throw new BadRequestException(
      `ttl_seconds must not exceed ${maxTtl} seconds for aud=${aud}`,
    )
  }

  if (scope.includes(RoostScope.TENANT_PROVISION)) {
    if (aud !== RoostAudience.CONTROL) {
      throw new BadRequestException('tenant:provision is only valid on the control plane')
    }
    if (scope.length !== 1) {
      throw new BadRequestException('tenant:provision credentials cannot carry any other scope')
    }
    if (orgId !== null) {
      throw new BadRequestException('tenant:provision credentials must not carry an org_id')
    }
    if (sandboxId !== null) {
      throw new BadRequestException('tenant:provision credentials must not carry a sandbox_id')
    }
    return { aud, orgId: null, sandboxId: null, scope, ttlSeconds }
  }

  if (!orgId) {
    throw new BadRequestException('org_id is required for every scope except tenant:provision')
  }

  if (aud === RoostAudience.DATA) {
    if (!sandboxId) {
      throw new BadRequestException('sandbox_id is required for daytona-data credentials')
    }
    const nonDataScopes = scope.filter((item) => !ROOST_DATA_PLANE_SCOPES.includes(item))
    if (nonDataScopes.length > 0) {
      throw new BadRequestException(
        `daytona-data credentials only allow these scopes: ${ROOST_DATA_PLANE_SCOPES.join(', ')}`,
      )
    }
    return { aud, orgId, sandboxId, scope, ttlSeconds }
  }

  if (sandboxId !== null) {
    throw new BadRequestException('sandbox_id must be empty for daytona-control credentials')
  }
  const dataScopesOnControl = scope.filter((item) => ROOST_DATA_PLANE_SCOPES.includes(item))
  if (dataScopesOnControl.length > 0) {
    throw new BadRequestException(
      `${dataScopesOnControl.join(', ')} require a daytona-data credential bound to a sandbox`,
    )
  }

  return { aud, orgId, sandboxId, scope, ttlSeconds }
}

function normalizeScopeList(raw: string[] | string | undefined): string[] {
  if (raw === undefined || raw === null) {
    return []
  }
  const list = Array.isArray(raw) ? raw : raw.split(/[\s,]+/)
  return Array.from(
    new Set(
      list
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  )
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Expected a string value')
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
