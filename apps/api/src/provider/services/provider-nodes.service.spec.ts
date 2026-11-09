/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { NotFoundException } from '@nestjs/common'
import { ProviderNodesService } from './provider-nodes.service'

describe('ProviderNodesService (acceptance)', () => {
  const runnerDto = {
    id: 'runner-1',
    name: 'node-1',
    region: 'region-1',
    state: 'ready',
    unschedulable: false,
    lastChecked: '2026-11-09T12:00:00.000Z',
    cpu: 8,
    memory: 16,
    disk: 100,
    currentCpuUsagePercentage: 45.5,
    currentMemoryUsagePercentage: 60.2,
    currentDiskUsagePercentage: 35.8,
    currentAllocatedCpu: 4,
    currentAllocatedMemoryGiB: 8,
    currentAllocatedDiskGiB: 50,
    currentStartedSandboxes: 2,
    availabilityScore: 9.2,
    appVersion: 'v0.190.0',
  }

  const createService = (regionOrganizationId: string | null = 'org-1') => {
    const runnerService = {
      findAllByOrganization: jest.fn(async () => [runnerDto]),
      findOne: jest.fn(async () => ({
        id: 'runner-1',
        region: 'region-1',
        name: 'node-1',
        state: 'ready',
        unschedulable: false,
        cpu: 8,
        memoryGiB: 16,
        diskGiB: 100,
        lastChecked: new Date('2026-11-09T12:00:00.000Z'),
        apiVersion: '2',
        tags: [],
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        updatedAt: new Date('2026-11-09T00:00:00.000Z'),
      })),
    }
    const regionService = {
      findAllByOrganization: jest.fn(async () => [{ id: 'region-1', name: 'my-region' }]),
      getOrganizationId: jest.fn(async () => regionOrganizationId),
    }
    const sandboxRepository = {
      find: jest.fn(async () => [
        {
          id: 'sandbox-1',
          name: 'my-sandbox',
          state: 'started',
          cpu: 2,
          mem: 4,
          disk: 10,
          createdAt: new Date('2026-11-09T00:00:00.000Z'),
        },
      ]),
    }
    const metricsService = {
      getMetricsForRunners: jest.fn(
        async () =>
          new Map([
            [
              'runner-1',
              {
                rttMs: 12.4,
                sandboxStarts7d: 10,
                sandboxStartFailures7d: 1,
                avgStartupSeconds7d: 8.4,
                openAlertCount: 2,
              },
            ],
          ]),
      ),
    }

    const service = new ProviderNodesService(
      runnerService as any,
      regionService as any,
      sandboxRepository as any,
      metricsService as any,
    )

    return { service, runnerService, regionService, sandboxRepository, metricsService }
  }

  it('maps nodes with region name, watermarks and 7 day metrics', async () => {
    const { service, metricsService } = createService()

    const nodes = await service.listNodes('org-1')

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      runnerId: 'runner-1',
      name: 'node-1',
      regionId: 'region-1',
      regionName: 'my-region',
      state: 'ready',
      lastCheckedAt: '2026-11-09T12:00:00.000Z',
      totalCpu: 8,
      totalMemoryGiB: 16,
      totalDiskGiB: 100,
      cpuUsagePct: 45.5,
      memoryUsagePct: 60.2,
      diskUsagePct: 35.8,
      allocatedCpu: 4,
      allocatedMemoryGiB: 8,
      allocatedDiskGiB: 50,
      startedSandboxes: 2,
      availabilityScore: 9.2,
      appVersion: 'v0.190.0',
      rttMs: 12.4,
      sandboxStarts7d: 10,
      sandboxStartFailures7d: 1,
      avgStartupSeconds7d: 8.4,
      openAlertCount: 2,
    })
    expect(metricsService.getMetricsForRunners).toHaveBeenCalledWith(['runner-1'])
  })

  it('lists sandboxes of an owned node', async () => {
    const { service, sandboxRepository } = createService()

    const sandboxes = await service.listNodeSandboxes('org-1', 'runner-1')

    expect(sandboxes).toEqual([
      {
        sandboxId: 'sandbox-1',
        name: 'my-sandbox',
        state: 'started',
        cpu: 2,
        memoryGiB: 4,
        diskGiB: 10,
        createdAt: '2026-11-09T00:00:00.000Z',
        startedAt: null,
      },
    ])
    expect(sandboxRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runnerId: 'runner-1', organizationId: 'org-1' } }),
    )
  })

  it('rejects nodes of another organization', async () => {
    const { service } = createService('org-2')

    await expect(service.listNodeSandboxes('org-1', 'runner-1')).rejects.toBeInstanceOf(NotFoundException)
  })
})
