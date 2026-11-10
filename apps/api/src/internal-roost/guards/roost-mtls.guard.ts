/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { TLSSocket } from 'node:tls'
import { TypedConfigService } from '../../config/typed-config.service'
import { getRoostInternalRequest } from '../interfaces/roost-request.interface'
import { isLoopbackAddress } from '../internal-roost.constants'

/**
 * Authenticates the caller of `POST /internal/roost/v1/credentials` with mTLS.
 *
 * - With `INTERNAL_ROOST_TLS_CA_PATH` configured the listener requires a client
 *   certificate and this guard only accepts authorized peers (optionally restricted by
 *   `INTERNAL_ROOST_CLIENT_CN_ALLOWLIST`).
 * - Without a CA the internal API can only be reached on a loopback connection in
 *   non-production environments (explicit warning is logged). Production refuses to
 *   start without mTLS.
 */
@Injectable()
export class RoostMtlsGuard implements CanActivate {
  private readonly logger = new Logger(RoostMtlsGuard.name)
  private warnedAboutDevFallback = false

  constructor(private readonly configService: TypedConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = getRoostInternalRequest(context.switchToHttp().getRequest())

    if (!request.roostInternalListener) {
      throw new UnauthorizedException('Internal Roost API is only served by the internal listener')
    }

    const internalRoost = this.configService.get('internalRoost')

    if (internalRoost.tls.caPath) {
      const socket = request.socket as TLSSocket
      if (!socket.authorized) {
        throw new UnauthorizedException('Client certificate is not authorized')
      }

      const peer = socket.getPeerCertificate?.()
      const commonName = peer?.subject?.CN
      const allowlist = internalRoost.tls.clientCnAllowlist
      if (allowlist.length > 0 && (!commonName || !allowlist.includes(commonName))) {
        throw new ForbiddenException('Client certificate is not allowed to call the internal Roost API')
      }

      request.roostMtls = {
        subject: commonName ? `CN=${commonName}` : peer?.fingerprint256 ? `sha256=${peer.fingerprint256}` : 'client-certificate',
        fingerprint: peer?.fingerprint256,
      }
      return true
    }

    // No CA configured: never fall back to mTLS-less access outside development.
    if (this.configService.get('production')) {
      throw new ServiceUnavailableException('Internal Roost mTLS is not configured')
    }

    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      throw new ForbiddenException('Internal Roost API requires mTLS or a loopback connection')
    }

    if (!this.warnedAboutDevFallback) {
      this.warnedAboutDevFallback = true
      this.logger.warn(
        'INTERNAL_ROOST_TLS_CA_PATH is not set: internal Roost API accepts UNAUTHENTICATED callers from loopback only (development fallback). Configure TLS + CA before deploying.',
      )
    }

    request.roostMtls = { subject: 'dev-loopback' }
    return true
  }
}
