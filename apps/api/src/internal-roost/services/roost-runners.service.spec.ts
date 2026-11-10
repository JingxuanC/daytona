/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { RunnerState } from '../../sandbox/enums/runner-state.enum'
import { normalizeCreateRunnerBody, RoostRunnersService } from './roost-runners.service'

const RUNNER = {
  id: 'runner-1',
  region: 'node_abc',
  state: RunnerState.READY,
  lastChecked: new Date('2026-11-10T12:00:00.000Z'),
  unschedulable: false,
}

function createService(
  options: {
    runner?: typeof RUNNER | null
    region?: { id: string; organizationId: string | null } | null
    sandboxCountError?: boolean
  } = {},
) {
  const runnerService = {
    findOne: jest.fn(async () => (options.runner === undefined ? RUNNER : options.runner)),
    create: jest.fn(async () => ({ runner: { id: 'runner-created' }, apiKey: 'dtn_api_key' })),
    remove: jest.fn(async () => undefined),
    updateSchedulingStatus: jest.fn(async (id: string, unschedulable: boolean) => ({ id, unschedulable })),
  }
  const regionService = {
    findOne: jest.fn(async () =>
      options.region === undefined ? { id: 'node_abc', organizationId: 'org-1' } : options.region,
    ),
  }
  const sandboxRepository = {
    count: jest.fn(async () => {
      if (options.sandboxCountError) {
        throw new Error('db unavailable')
      }
      return 2
    }),
  }
  const service = new RoostRunnersService(runnerService as any, regionService as any, sandboxRepository as any)
  return { service, runnerService, regionService, sandboxRepository }
}

describe('RoostRunnersService.getRunnerHeartbeat', () => {
  it('returns the minimal heartbeat view for an owned runner', async () => {
    const { service } = createService()

    const result = await service.getRunnerHeartbeat('org-1', 'runner-1')

    expect(result).toEqual({
      runner_id: 'runner-1',
      state: 'ready',
      last_seen_at: '2026-11-10T12:00:00.000Z',
      sandbox_count: 2,
    })
  })

  it('returns a null sandbox count when counting fails', async () => {
    const { service } = createService({ sandboxCountError: true })
    const result = await service.getRunnerHeartbeat('org-1', 'runner-1')
    expect(result.sandbox_count).toBeNull()
  })

  it('returns null lastCheckedAt for a runner that never checked in', async () => {
    const { service } = createService({ runner: { ...RUNNER, lastChecked: null as any } })
    const result = await service.getRunnerHeartbeat('org-1', 'runner-1')
    expect(result.last_seen_at).toBeNull()
  })

  it('returns 404 for an unknown runner', async () => {
    const { service } = createService({ runner: null })
    await expect(service.getRunnerHeartbeat('org-1', 'missing')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns 404 for a runner owned by another organization (no existence leak)', async () => {
    const { service } = createService({ region: { id: 'node_abc', organizationId: 'org-other' } })
    await expect(service.getRunnerHeartbeat('org-1', 'runner-1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('RoostRunnersService.createRunner', () => {
  it('creates a v2 runner in an owned region and returns the api_key exactly once', async () => {
    const { service, runnerService } = createService()

    const result = await service.createRunner('org-1', 'node_abc', { name: 'node-a', tags: ['gpu'] })

    expect(runnerService.create).toHaveBeenCalledWith({
      apiVersion: '2',
      regionId: 'node_abc',
      name: 'node-a',
      tags: ['gpu'],
    })
    expect(result).toEqual({ runner_id: 'runner-created', api_key: 'dtn_api_key' })
  })

  it('rejects a region that belongs to another organization', async () => {
    const { service, runnerService } = createService({ region: { id: 'node_abc', organizationId: 'org-other' } })
    await expect(service.createRunner('org-1', 'node_abc', { name: 'node-a' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(runnerService.create).not.toHaveBeenCalled()
  })

  it('rejects an unknown region', async () => {
    const { service } = createService({ region: null })
    await expect(service.createRunner('org-1', 'node_missing', { name: 'node-a' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})

describe('RoostRunnersService.deleteRunner', () => {
  it('marks an owned runner unschedulable and deletes it', async () => {
    const { service, runnerService } = createService()
    await service.deleteRunner('org-1', 'runner-1')
    expect(runnerService.updateSchedulingStatus).toHaveBeenCalledWith('runner-1', true)
    expect(runnerService.remove).toHaveBeenCalledWith('runner-1')
  })

  it('does not delete a runner whose sandbox count cannot be determined', async () => {
    const { service, runnerService } = createService({ sandboxCountError: true })
    await expect(service.deleteRunner('org-1', 'runner-1')).rejects.toBeInstanceOf(BadRequestException)
    expect(runnerService.remove).not.toHaveBeenCalled()
  })

  it('refuses to delete a runner owned by another organization', async () => {
    const { service, runnerService } = createService({ region: { id: 'node_abc', organizationId: 'org-other' } })
    await expect(service.deleteRunner('org-1', 'runner-1')).rejects.toBeInstanceOf(NotFoundException)
    expect(runnerService.remove).not.toHaveBeenCalled()
  })
})

describe('normalizeCreateRunnerBody', () => {
  it('requires a name and validates tags', () => {
    expect(() => normalizeCreateRunnerBody({})).toThrow(BadRequestException)
    expect(() => normalizeCreateRunnerBody({ name: 'node-a', tags: [1] as any })).toThrow(BadRequestException)
    expect(normalizeCreateRunnerBody({ name: ' node-a ', tags: [' gpu ', ''] })).toEqual({
      name: 'node-a',
      tags: ['gpu'],
    })
  })
})
