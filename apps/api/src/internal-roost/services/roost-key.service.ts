/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { KeyObject } from 'node:crypto'
import { TypedConfigService } from '../../config/typed-config.service'
import {
  createEd25519PrivateKey,
  createEd25519PublicKey,
  derivePublicKey,
  generateEd25519KeyPair,
  RoostJwtError,
  signRoostJwt,
  verifyRoostJwt,
} from '../jwt/ed25519-jwt.util'
import { RoostJwtClaims } from '../interfaces/roost-jwt-claims.interface'

/**
 * Owns the Ed25519 key pair used to sign/verify short-lived Roost credentials.
 *
 * Production must configure a key pair (`INTERNAL_ROOST_JWT_PRIVATE_KEY_PATH` /
 * `INTERNAL_ROOST_JWT_PUBLIC_KEY_PATH`, or the `*_PEM` variants). In development an
 * ephemeral key pair is generated so the fork runs out of the box; all credentials
 * become invalid on restart (exactly what short-lived credentials are meant to do).
 */
@Injectable()
export class RoostKeyService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RoostKeyService.name)
  private privateKey?: KeyObject
  private publicKey?: KeyObject
  private ephemeral = false

  constructor(private readonly configService: TypedConfigService) {}

  onModuleInit(): void {
    // Never fail process boot here: when the internal listener is disabled or not
    // configured, the keys are not needed. Signing/verifying throws a clear error.
    try {
      this.loadKeys()
    } catch (error) {
      this.logger.error((error as Error).message)
    }
  }

  onApplicationShutdown(): void {
    this.privateKey = undefined
    this.publicKey = undefined
  }

  isEphemeral(): boolean {
    return this.ephemeral
  }

  sign(claims: RoostJwtClaims): string {
    return signRoostJwt(claims, this.getPrivateKey())
  }

  verify(token: string, nowSeconds?: number): RoostJwtClaims {
    return verifyRoostJwt(token, this.getPublicKey(), nowSeconds)
  }

  /** Number of seconds until the listening process can no longer verify old credentials. */
  get keySourceDescription(): string {
    return this.ephemeral ? 'ephemeral (development)' : 'configured'
  }

  private getPrivateKey(): KeyObject {
    if (!this.privateKey) {
      this.loadKeys()
    }
    if (!this.privateKey) {
      throw new Error('Roost JWT private key is not configured')
    }
    return this.privateKey
  }

  private getPublicKey(): KeyObject {
    if (!this.publicKey) {
      this.loadKeys()
    }
    if (!this.publicKey) {
      throw new Error('Roost JWT public key is not configured')
    }
    return this.publicKey
  }

  private loadKeys(): void {
    const jwt = this.configService.get('internalRoost.jwt')
    const isProduction = this.configService.get('production')

    const privateKeyPem = this.readPem(jwt.privateKeyPem, jwt.privateKeyPath, 'private')
    const publicKeyPem = this.readPem(jwt.publicKeyPem, jwt.publicKeyPath, 'public')

    if (privateKeyPem) {
      this.privateKey = createEd25519PrivateKey(privateKeyPem)
      this.publicKey = publicKeyPem ? createEd25519PublicKey(publicKeyPem) : derivePublicKey(this.privateKey)
      this.ephemeral = false
      return
    }

    if (isProduction) {
      // Keep booting: `InternalRoostServerService` refuses to start the listener when
      // the JWT keys are missing in production, so this can never be reached by traffic.
      this.logger.error(
        'INTERNAL_ROOST_JWT_PRIVATE_KEY_PATH (or INTERNAL_ROOST_JWT_PRIVATE_KEY) is not configured: internal Roost credentials cannot be signed/verified',
      )
      return
    }

    const { privateKey, publicKey } = generateEd25519KeyPair()
    this.privateKey = privateKey
    this.publicKey = publicKey
    this.ephemeral = true
    this.logger.warn(
      'Internal Roost JWT keys are not configured: generated an EPHEMERAL Ed25519 key pair (development only). All short-lived credentials become invalid on restart.',
    )
  }

  private readPem(inlinePem: string | undefined, path: string | undefined, keyType: string): string | undefined {
    if (inlinePem && inlinePem.trim().length > 0) {
      // Allow `\n` escaped single-line environment variables.
      return inlinePem.includes('\\n') ? inlinePem.replace(/\\n/g, '\n') : inlinePem
    }
    if (path && path.trim().length > 0) {
      try {
        return readFileSync(path, 'utf8')
      } catch (error) {
        throw new Error(`Unable to read internal Roost JWT ${keyType} key from ${path}: ${error.message}`)
      }
    }
    return undefined
  }
}

export { RoostJwtError }
