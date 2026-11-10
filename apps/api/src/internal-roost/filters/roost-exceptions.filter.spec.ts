/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ArgumentsHost } from '@nestjs/common'
import { mapStatusToRoostErrorCode, RoostExceptionsFilter } from './roost-exceptions.filter'

function createHost(headers: Record<string, string> = {}): {
  host: ArgumentsHost
  response: { statusCode: number; body: unknown; status: (code: number) => void; json: (body: unknown) => void }
} {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost
  return { host, response }
}

describe('RoostExceptionsFilter', () => {
  const filter = new RoostExceptionsFilter()

  it('renders the contract error envelope with details and the request id', () => {
    const { host, response } = createHost({ 'x-request-id': 'req-1' })

    filter.catch(
      new ForbiddenException({ message: 'Missing required scope(s): region:write', details: { missing_scopes: ['region:write'] } }),
      host,
    )

    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({
      error: {
        code: 'forbidden',
        message: 'Missing required scope(s): region:write',
        request_id: 'req-1',
        details: { missing_scopes: ['region:write'] },
      },
    })
  })

  it('maps 404/409/400 to not_found/conflict/invalid_request', () => {
    expect(mapStatusToRoostErrorCode(404)).toBe('not_found')
    expect(mapStatusToRoostErrorCode(409)).toBe('conflict')
    expect(mapStatusToRoostErrorCode(400)).toBe('invalid_request')
    expect(mapStatusToRoostErrorCode(401)).toBe('unauthorized')
    expect(mapStatusToRoostErrorCode(503)).toBe('upstream_unavailable')
  })

  it('generates a request id when the header is missing', () => {
    const { host, response } = createHost()
    filter.catch(new NotFoundException('Sandbox not found'), host)

    expect(response.statusCode).toBe(404)
    expect((response.body as any).error.code).toBe('not_found')
    expect(typeof (response.body as any).error.request_id).toBe('string')
    expect((response.body as any).error.request_id.length).toBeGreaterThan(0)
  })

  it('turns an unexpected error into a 500 upstream_unavailable envelope', () => {
    const { host, response } = createHost()
    filter.catch(new Error('boom'), host)

    expect(response.statusCode).toBe(500)
    expect((response.body as any).error.code).toBe('upstream_unavailable')
  })
})

describe('mapStatusToRoostErrorCode', () => {
  it('maps validation-style exceptions to invalid_request', () => {
    expect(mapStatusToRoostErrorCode(422)).toBe('invalid_request')
    expect(mapStatusToRoostErrorCode(400)).toBe('invalid_request')
    expect(() => new BadRequestException('x')).not.toThrow()
  })
})
