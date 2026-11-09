/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getProviderApiErrorMessage } from '@/provider-api/client'
import { useProviderAlertsQuery, useResolveProviderAlertMutation } from '@/provider-api/queries'
import type { ProviderAlert } from '@/provider-api/types'
import { BellOff, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertSeverityBadge,
  SectionErrorState,
  TableSkeletonRows,
  formatDateTime,
  formatRelativeTime,
  getAlertTypeLabel,
} from './shared'

type AlertStateFilter = 'open' | 'resolved'

const ALERT_TABLE_COLUMNS = 7
const ALERT_LIMIT = 50

export function AlertsTab({ writePermitted }: { writePermitted: boolean }) {
  const [stateFilter, setStateFilter] = useState<AlertStateFilter>('open')
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null)

  const alertsQuery = useProviderAlertsQuery(stateFilter, ALERT_LIMIT)
  const resolveAlertMutation = useResolveProviderAlertMutation()
  const alerts = useMemo(() => alertsQuery.data?.items ?? [], [alertsQuery.data])

  const handleResolve = async (alert: ProviderAlert) => {
    setResolvingAlertId(alert.id)
    try {
      await resolveAlertMutation.mutateAsync(alert.id)
      toast.success('告警已标记为已处理')
    } catch (error) {
      toast.error(getProviderApiErrorMessage(error, '处理告警失败'))
    } finally {
      setResolvingAlertId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-medium">节点告警</h2>
          <span className="text-xs text-muted-foreground">
            共 {alerts.length} 条 · 最多显示最近 {ALERT_LIMIT} 条
          </span>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={stateFilter}
          onValueChange={(value) => {
            if (value) {
              setStateFilter(value as AlertStateFilter)
            }
          }}
        >
          <ToggleGroupItem value="open">未处理</ToggleGroupItem>
          <ToggleGroupItem value="resolved">已处理</ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => void alertsQuery.refetch()}
          disabled={alertsQuery.isFetching}
        >
          <RefreshCw className={alertsQuery.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
          刷新
        </Button>
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>节点</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>级别</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>处理时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alertsQuery.isLoading ? (
              <TableSkeletonRows columns={ALERT_TABLE_COLUMNS} rows={4} />
            ) : alertsQuery.isError ? (
              <TableRow>
                <TableCell colSpan={ALERT_TABLE_COLUMNS} className="border-0">
                  <SectionErrorState
                    title="无法加载告警"
                    description={getProviderApiErrorMessage(alertsQuery.error, '请稍后重试或确认后端 API 已就绪')}
                    onRetry={() => void alertsQuery.refetch()}
                    retrying={alertsQuery.isFetching}
                  />
                </TableCell>
              </TableRow>
            ) : alerts.length === 0 ? (
              <TableEmptyState
                colSpan={ALERT_TABLE_COLUMNS}
                message={stateFilter === 'open' ? '暂无未处理告警' : '暂无已处理告警'}
                icon={<BellOff />}
                description={
                  stateFilter === 'open'
                    ? '节点离线、健康检查失败或资源压力触发告警后会展示在这里。'
                    : '已处理的告警会保留用于回溯。'
                }
              />
            ) : (
              alerts.map((alert) => {
                const isResolving = resolvingAlertId === alert.id

                return (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm whitespace-nowrap">{formatRelativeTime(alert.createdAt)}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(alert.createdAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm" title={alert.runnerName}>
                          {alert.runnerName}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {alert.runnerId.slice(0, 8)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{getAlertTypeLabel(alert.type)}</TableCell>
                    <TableCell>
                      <AlertSeverityBadge severity={alert.severity} />
                    </TableCell>
                    <TableCell>
                      <span className="line-clamp-2 max-w-[420px] text-sm" title={alert.message}>
                        {alert.message}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {alert.resolvedAt ? formatDateTime(alert.resolvedAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {writePermitted && !alert.resolvedAt ? (
                        <Button variant="outline" size="sm" disabled={isResolving} onClick={() => void handleResolve(alert)}>
                          {isResolving ? <Spinner /> : null}
                          标记已处理
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {alert.resolvedAt ? '已处理' : '需 Runner 写权限'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  )
}
