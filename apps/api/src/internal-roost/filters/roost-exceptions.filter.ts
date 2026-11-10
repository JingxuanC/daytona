/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Request, Response } from 'express'
import { INTERNAL_ROOST_REQUEST_ID_HEADER } from '../internal-roost.constants'

export type RoostErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_request'
  | 'upstream_unavailable'

/**
 * Shapes every internal Roost API error as the contract's error envelope:
 *
 * ```json
 * { "error": { "code": "invalid_request", "message": "...", "request_id": "..." } }
 * ```
 *
 * Controller scoped, so the public `/api` error format is untouched.
 */
@Catch()
export class RoostExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(RoostExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<Request>()
    const response = ctx.getResponse<Response>()

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const code = mapStatusToRoostErrorCode(status)

    let message = 'An unexpected error occurred.'
    let details: Record<string, unknown> | undefined

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse()
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (exceptionResponse && typeof exceptionResponse === 'object') {
        const record = exceptionResponse as Record<string, unknown>
        const rawMessage = record.message
        if (Array.isArray(rawMessage)) {
          message = rawMessage.join(', ')
        } else if (typeof rawMessage === 'string') {
          message = rawMessage
        } else {
          message = exception.message
        }
        if (record.details && typeof record.details === 'object') {
          details = record.details as Record<string, unknown>
        }
      } else {
        message = exception.message
      }
    } else {
      this.logger.error(exception)
    }

    if (response.headersSent) {
      return
    }

    const body: Record<string, unknown> = {
      error: {
        code,
        message,
        request_id: this.getRequestId(request),
        ...(details ? { details } : {}),
      },
    }

    response.status(status).json(body)
  }

  private getRequestId(request: Request): string {
    const header = request.headers?.[INTERNAL_ROOST_REQUEST_ID_HEADER]
    if (typeof header === 'string' && header.trim().length > 0) {
      return header.trim()
    }
    return randomUUID()
  }
}

export function mapStatusToRoostErrorCode(status: number): RoostErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized'
    case HttpStatus.FORBIDDEN:
      return 'forbidden'
    case HttpStatus.NOT_FOUND:
      return 'not_found'
    case HttpStatus.CONFLICT:
      return 'conflict'
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'invalid_request'
    default:
      if (status >= 500) {
        return 'upstream_unavailable'
      }
      return 'invalid_request'
  }
}
