/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { NotFoundException } from '@nestjs/common'
import { InMemoryRepository } from '../../test/helpers/provider-test.helper'
import { RunnerAlertSeverity, RunnerAlertType } from '../entities/runner-alert.entity'
import { ProviderAlertsService } from './provider-alerts.service'

describe('ProviderAlertsService (acceptance)', () => {
  const runnerService = {
    findByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: 'node-1' }))),
  }

  const createService = () => {
    const alertRepository = new InMemoryRepository<any>()
    const service = new ProviderAlertsService(alertRepository as any, runnerService as any)
    return { service, alertRepository }
  }

  const raiseParams = {
    organizationId: 'org-1',
    runnerId: 'runner-1',
    type: RunnerAlertType.OFFLINE,
    severity: RunnerAlertSeverity.CRITICAL,
    message: 'Node has not reported a heartbeat',
  }

  it('deduplicates open alerts of the same type', async () => {
    const { service, alertRepository } = createService()

    expect(await service.raiseAlert(raiseParams)).toBe(true)
    expect(await service.raiseAlert(raiseParams)).toBe(false)
    expect(alertRepository.rows).toHaveLength(1)
    expect(alertRepository.rows[0]).toMatchObject({ type: RunnerAlertType.OFFLINE, resolvedAt: null })
  })

  it('resolves open alerts and allows a new alert afterwards', async () => {
    const { service, alertRepository } = createService()

    await service.raiseAlert(raiseParams)
    const resolvedCount = await service.resolveOpenAlerts('runner-1', RunnerAlertType.OFFLINE)

    expect(resolvedCount).toBe(1)
    expect(alertRepository.rows[0].resolvedAt).toBeInstanceOf(Date)

    expect(await service.raiseAlert(raiseParams)).toBe(true)
    expect(alertRepository.rows).toHaveLength(2)
  })

  it('does not resolve alerts of another node or type', async () => {
    const { service, alertRepository } = createService()

    await service.raiseAlert(raiseParams)
    expect(await service.resolveOpenAlerts('runner-2', RunnerAlertType.OFFLINE)).toBe(0)
    expect(await service.resolveOpenAlerts('runner-1', RunnerAlertType.HIGH_LATENCY)).toBe(0)
    expect(alertRepository.rows[0].resolvedAt).toBeNull()
  })

  it('lists open alerts and resolves a single alert', async () => {
    const { service, alertRepository } = createService()
    alertRepository.rows.push({
      id: 'alert-1',
      organizationId: 'org-1',
      runnerId: 'runner-1',
      type: RunnerAlertType.OFFLINE,
      severity: RunnerAlertSeverity.CRITICAL,
      message: 'offline',
      details: { lastCheckedAt: null },
      createdAt: new Date('2026-11-09T00:00:00.000Z'),
      resolvedAt: null,
    })

    const open = await service.listAlerts('org-1', { state: 'open' })
    expect(open.items).toHaveLength(1)
    expect(open.items[0]).toMatchObject({ id: 'alert-1', runnerName: 'node-1', type: RunnerAlertType.OFFLINE })

    const resolved = await service.resolveAlert('org-1', 'alert-1')
    expect(resolved.resolvedAt).toBeTruthy()

    const after = await service.listAlerts('org-1', { state: 'open' })
    expect(after.items).toHaveLength(0)
  })

  it('rejects alerts of other organizations', async () => {
    const { service, alertRepository } = createService()
    alertRepository.rows.push({
      id: 'alert-1',
      organizationId: 'org-1',
      runnerId: 'runner-1',
      type: RunnerAlertType.OFFLINE,
      severity: RunnerAlertSeverity.CRITICAL,
      message: 'offline',
      details: null,
      createdAt: new Date('2026-11-09T00:00:00.000Z'),
      resolvedAt: null,
    })

    await expect(service.resolveAlert('org-2', 'alert-1')).rejects.toBeInstanceOf(NotFoundException)
  })
})
