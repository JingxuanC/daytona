/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  base64UrlEncode,
  generateEd25519KeyPair,
  RoostJwtError,
  signRoostJwt,
  verifyRoostJwt,
} from './ed25519-jwt.util'

function buildClaims(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: 'daytona',
    aud: 'daytona-control',
    sub: 'CN=market-api',
    org_id: 'org-1',
    sandbox_id: null,
    scope: ['sandbox:control'],
    iat: now,
    exp: now + 60,
    jti: 'jti-1',
    ...overrides,
  } as any
}

describe('ed25519-jwt util', () => {
  it('signs and verifies an Ed25519 JWT round-trip', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair()
    const token = signRoostJwt(buildClaims(), privateKey)

    const claims = verifyRoostJwt(token, publicKey)

    expect(claims.iss).toBe('daytona')
    expect(claims.aud).toBe('daytona-control')
    expect(claims.org_id).toBe('org-1')
    expect(claims.scope).toEqual(['sandbox:control'])
    expect(claims.jti).toBe('jti-1')
  })

  it('rejects a tampered payload', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair()
    const token = signRoostJwt(buildClaims(), privateKey)
    const [header, , signature] = token.split('.')
    const tamperedPayload = base64UrlEncode(
      Buffer.from(JSON.stringify(buildClaims({ org_id: 'attacker-org' })), 'utf8'),
    )
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`

    expect(() => verifyRoostJwt(tamperedToken, publicKey)).toThrow(RoostJwtError)
  })

  it('rejects a token signed by another key', () => {
    const { privateKey } = generateEd25519KeyPair()
    const { publicKey: otherPublicKey } = generateEd25519KeyPair()
    const token = signRoostJwt(buildClaims(), privateKey)

    expect(() => verifyRoostJwt(token, otherPublicKey)).toThrow(RoostJwtError)
  })

  it('rejects an expired token', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair()
    const token = signRoostJwt(buildClaims({ exp: Math.floor(Date.now() / 1000) - 1 }), privateKey)

    expect(() => verifyRoostJwt(token, publicKey)).toThrow(/expired/)
  })

  it('rejects a non EdDSA algorithm header', () => {
    const { publicKey } = generateEd25519KeyPair()
    const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'))
    const payload = base64UrlEncode(Buffer.from(JSON.stringify(buildClaims()), 'utf8'))

    expect(() => verifyRoostJwt(`${header}.${payload}.signature`, publicKey)).toThrow(/Unsupported JWT algorithm/)
  })

  it('rejects malformed tokens', () => {
    const { publicKey } = generateEd25519KeyPair()
    expect(() => verifyRoostJwt('not-a-jwt', publicKey)).toThrow(/three dot-separated parts/)
    expect(() => verifyRoostJwt('', publicKey)).toThrow(/empty/)
  })
})
