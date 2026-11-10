/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, sign, verify } from 'node:crypto'
import { RoostJwtClaims } from '../interfaces/roost-jwt-claims.interface'

const JWT_HEADER = { alg: 'EdDSA', typ: 'JWT' }
const JWT_HEADER_BASE64 = base64UrlEncode(Buffer.from(JSON.stringify(JWT_HEADER)))

export type RoostJwtErrorReason =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'invalid_signature'
  | 'expired'
  | 'invalid_payload'

export class RoostJwtError extends Error {
  constructor(
    message: string,
    readonly reason: RoostJwtErrorReason,
  ) {
    super(message)
    this.name = 'RoostJwtError'
  }
}

export function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64')
}

/** Generates an in-memory Ed25519 key pair (dev fallback only; production must configure keys). */
export function generateEd25519KeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ed25519')
}

export function createEd25519PrivateKey(pem: string): KeyObject {
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Expected an Ed25519 private key, got ${key.asymmetricKeyType}`)
  }
  return key
}

export function createEd25519PublicKey(pem: string): KeyObject {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Expected an Ed25519 public key, got ${key.asymmetricKeyType}`)
  }
  return key
}

export function derivePublicKey(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey)
}

export function signRoostJwt(claims: RoostJwtClaims, privateKey: KeyObject): string {
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(claims), 'utf8'))
  const signingInput = `${JWT_HEADER_BASE64}.${payload}`
  const signature = sign(null, Buffer.from(signingInput, 'utf8'), privateKey)
  return `${signingInput}.${base64UrlEncode(signature)}`
}

/**
 * Verifies the Ed25519 signature and the payload shape.
 *
 * Audience, scope and issuer authorization are intentionally left to the guards;
 * this function only proves the token was signed by us and is not expired yet.
 */
export function verifyRoostJwt(token: string, publicKey: KeyObject, nowSeconds = Math.floor(Date.now() / 1000)): RoostJwtClaims {
  if (typeof token !== 'string' || token.length === 0) {
    throw new RoostJwtError('JWT is empty', 'malformed')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new RoostJwtError('JWT must have three dot-separated parts', 'malformed')
  }

  const [header, payload, signature] = parts

  let decodedHeader: { alg?: string; typ?: string }
  try {
    decodedHeader = JSON.parse(base64UrlDecode(header).toString('utf8'))
  } catch {
    throw new RoostJwtError('JWT header is not valid JSON', 'malformed')
  }

  if (decodedHeader.alg !== JWT_HEADER.alg) {
    throw new RoostJwtError(`Unsupported JWT algorithm: ${decodedHeader.alg}`, 'unsupported_algorithm')
  }

  const signingInput = Buffer.from(`${header}.${payload}`, 'utf8')
  let signatureValid = false
  try {
    signatureValid = verify(null, signingInput, publicKey, base64UrlDecode(signature))
  } catch {
    signatureValid = false
  }
  if (!signatureValid) {
    throw new RoostJwtError('JWT signature is invalid', 'invalid_signature')
  }

  let claims: RoostJwtClaims
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString('utf8'))
  } catch {
    throw new RoostJwtError('JWT payload is not valid JSON', 'invalid_payload')
  }

  if (!isValidClaimsShape(claims)) {
    throw new RoostJwtError('JWT payload is missing required claims', 'invalid_payload')
  }

  if (claims.exp <= nowSeconds) {
    throw new RoostJwtError('JWT has expired', 'expired')
  }

  return claims
}

function isValidClaimsShape(claims: Partial<RoostJwtClaims> | undefined): claims is RoostJwtClaims {
  if (!claims || typeof claims !== 'object') {
    return false
  }
  return (
    typeof claims.iss === 'string' &&
    typeof claims.aud === 'string' &&
    typeof claims.sub === 'string' &&
    (claims.org_id === null || typeof claims.org_id === 'string') &&
    (claims.sandbox_id === null || typeof claims.sandbox_id === 'string') &&
    Array.isArray(claims.scope) &&
    claims.scope.every((scope) => typeof scope === 'string') &&
    typeof claims.iat === 'number' &&
    typeof claims.exp === 'number' &&
    typeof claims.jti === 'string'
  )
}
