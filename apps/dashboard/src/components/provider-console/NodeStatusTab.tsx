/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { RefreshSegmentedButton, type RefreshIntervalValue } from '@/components/RefreshSegmentedButton'
import { TimestampTooltip } from '@/components/TimestampTooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import { cn } from '@/lib/utils'
import { getProviderApiErrorMessage } from '@/provider-api/client'
import { useProviderNodeSandboxesQuery, useProviderNodesQuery } from '@/provider-api/queries'
import type { ProviderNode } from '@/provider-api/types'
import { ChevronDown, RefreshCw, Server } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  getSuccessRate,
  NodeStateBadges,
  SandboxStateBadge,
  SectionErrorState,
  TableSkeletonRows,
  UsageBar,
} from './shared'

const NODE_TABLE_COLUMNS = 11

const NODE_REFRESH_OPTIONS = [
  { label: '关闭', value: false as const },
  { label: '每 10 秒', value: 10000 },
  { label: '每 30 秒', value: 30000 },
  { label: '每 1 分钟', value: 60000 },
]

export function NodeStatusTab() {
  const [refreshInterval, setRefreshInterval] = useState<RefreshIntervalValue>(false)
  const [expandedRunnerId, setExpandedRunnerId] = useState<string | null>(null)

  const nodesQuery = useProviderNodesQuery({ refetchInterval: refreshInterval })
  const nodes = useMemo(() => nodesQuery.data?.items ?? [], [nodesQuery.data])

  useEffect(() => {
    if (expandedRunnerId && !nodes.some((node) => node.runnerId === expandedRunnerId)) {
      setExpandedRunnerId(null)
    }
  }, [expandedRunnerId, nodes])

  const summary = useMemo(() => {
    return nodes.reduce(
      (acc, node) => {
        if (node.state === 'ready') {
          acc.ready += 1
        }
        if (node.unschedulable) {
          acc.unschedulable += 1
        }
        acc.openAlerts += node.openAlertCount ?? 0
        acc.sandboxes += node.startedSandboxes ?? 0
        return acc
      },
      { ready: 0, unschedulable: 0, openAlerts: 0, sandboxes: 0 },
    )
  }, [nodes])

  const isLoading = nodesQuery.isLoading
  const hasError = nodesQuery.isError && !nodesQuery.data

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-medium">节点状态</h2>
          <span className="text-xs text-muted-foreground">
            共 {nodes.length} 个节点 · 在线 {summary.ready} 个 · 沙箱 {summary.sandboxes} 个
          </span>
        </div>
        {summary.unschedulable > 0 ? (
          <Badge variant="outline" className="text-muted-foreground">
            {summary.unschedulable} 个不可调度
          </Badge>
        ) : null}
        {summary.openAlerts > 0 ? <Badge variant="destructive">{summary.openAlerts} 条未处理告警</Badge> : null}
        <RefreshSegmentedButton
          className="ml-auto"
          value={refreshInterval}
          onChange={setRefreshInterval}
          onRefresh={() => void nodesQuery.refetch()}
          isRefreshing={nodesQuery.isFetching}
          lastUpdatedAt={nodesQuery.dataUpdatedAt || undefined}
          options={NODE_REFRESH_OPTIONS}
        />
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>节点</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>最后心跳</TableHead>
              <TableHead className="text-right">RTT</TableHead>
              <TableHead>CPU 水位</TableHead>
              <TableHead>内存水位</TableHead>
              <TableHead>磁盘水位</TableHead>
              <TableHead className="text-right">沙箱</TableHead>
              <TableHead className="text-right">7 日成功率</TableHead>
              <TableHead className="text-right">平均启动</TableHead>
              <TableHead>告警</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={NODE_TABLE_COLUMNS} rows={4} />
            ) : hasError ? (
              <TableRow>
                <TableCell colSpan={NODE_TABLE_COLUMNS} className="border-0">
                  <SectionErrorState
                    title="无法加载节点状态"
                    description={getProviderApiErrorMessage(nodesQuery.error, '请稍后重试或确认后端 API 已就绪')}
                    onRetry={() => void nodesQuery.refetch()}
                    retrying={nodesQuery.isFetching}
                  />
                </TableCell>
              </TableRow>
            ) : nodes.length === 0 ? (
              <TableEmptyState
                colSpan={NODE_TABLE_COLUMNS}
                message="暂无节点"
                icon={<Server />}
                description="组织内注册节点后，这里会展示节点状态、资源水位与启动指标。"
              />
            ) : (
              nodes.map((node) => {
                const isExpanded = expandedRunnerId === node.runnerId
                return (
                  <Fragment key={node.runnerId}>
                    <TableRow
                      className="cursor-pointer"
                      data-state={isExpanded ? 'selected' : undefined}
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedRunnerId(isExpanded ? null : node.runnerId)}
                    >
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <ChevronDown
                            className={cn(
                              'size-4 shrink-0 text-muted-foreground transition-transform',
                              isExpanded && 'rotate-180',
                            )}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium" title={node.name}>
                              {node.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground" title={node.runnerId}>
                              {node.regionName || node.regionId} · {node.runnerId.slice(0, 8)}
                              {node.appVersion ? ` · ${node.appVersion}` : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <NodeStateBadges state={node.state} unschedulable={node.unschedulable} />
                      </TableCell>
                      <TableCell>
                        {node.lastCheckedAt ? (
                          <TimestampTooltip timestamp={node.lastCheckedAt}>
                            <span className="cursor-default text-sm">{formatRelativeTime(node.lastCheckedAt)}</span>
                          </TimestampTooltip>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {node.rttMs === null || node.rttMs === undefined ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              'text-sm tabular-nums',
                              node.rttMs >= 200 && 'text-warning-foreground',
                              node.rttMs >= 500 && 'text-destructive-foreground',
                            )}
                          >
                            {formatNumber(node.rttMs, 1)} ms
                          </span>
                        )}
                      </TableCell>
                      <NodeResourceCell
                        usagePct={node.cpuUsagePct}
                        title={`已分配 ${formatNumber(node.allocatedCpu)} / 共 ${formatNumber(node.totalCpu)} vCPU`}
                      />
                      <NodeResourceCell
                        usagePct={node.memoryUsagePct}
                        title={`已分配 ${formatNumber(node.allocatedMemoryGiB)} / 共 ${formatNumber(
                          node.totalMemoryGiB,
                        )} GiB`}
                      />
                      <NodeResourceCell
                        usagePct={node.diskUsagePct}
                        title={`已分配 ${formatNumber(node.allocatedDiskGiB)} / 共 ${formatNumber(
                          node.totalDiskGiB,
                        )} GiB`}
                      />
                      <TableCell className="text-right">
                        <span className="text-sm tabular-nums">{formatNumber(node.startedSandboxes, 0)}</span>
                      </TableCell>
                      <TableCell className="text-right">{renderSuccessRate(node)}</TableCell>
                      <TableCell className="text-right">
                        {node.avgStartupSeconds7d === null || node.avgStartupSeconds7d === undefined ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <span className="text-sm tabular-nums">{formatNumber(node.avgStartupSeconds7d, 1)} 秒</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {node.openAlertCount > 0 ? (
                          <Badge variant="destructive">{node.openAlertCount} 条</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={NODE_TABLE_COLUMNS}
                          className="border-0 bg-muted/30 p-0 group-hover/row:bg-muted/30"
                        >
                          <NodeSandboxesPanel runnerId={node.runnerId} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  )
}

function NodeResourceCell({ usagePct, title }: { usagePct: number; title: string }) {
  return (
    <TableCell title={title}>
      <UsageBar pct={usagePct} />
    </TableCell>
  )
}

function renderSuccessRate(node: ProviderNode) {
  const successRate = getSuccessRate(node.sandboxStarts7d, node.sandboxStartFailures7d)

  if (successRate === null) {
    return <span className="text-sm text-muted-foreground">—</span>
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={cn(
          'text-sm tabular-nums',
          successRate < 90 && 'text-warning-foreground',
          successRate < 70 && 'text-destructive-foreground',
        )}
      >
        {formatPercent(successRate)}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatNumber(node.sandboxStarts7d, 0)} 次 · 失败 {formatNumber(node.sandboxStartFailures7d, 0)}
      </span>
    </div>
  )
}

const SANDBOX_TABLE_COLUMNS = 7

function NodeSandboxesPanel({ runnerId }: { runnerId: string }) {
  const sandboxesQuery = useProviderNodeSandboxesQuery(runnerId)
  const sandboxes = useMemo(() => sandboxesQuery.data?.items ?? [], [sandboxesQuery.data])

  return (
    <div className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">节点沙箱</span>
        {sandboxesQuery.data ? (
          <span className="text-xs text-muted-foreground">{sandboxes.length} 个</span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => void sandboxesQuery.refetch()}
          disabled={sandboxesQuery.isFetching}
        >
          <RefreshCw className={cn('size-3', sandboxesQuery.isFetching && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {sandboxesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : sandboxesQuery.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive-separator bg-destructive-background/40 px-3 py-2">
          <p className="text-xs text-destructive-foreground">
            {getProviderApiErrorMessage(sandboxesQuery.error, '加载节点沙箱失败')}
          </p>
          <Button variant="outline" size="sm" onClick={() => void sandboxesQuery.refetch()}>
            重试
          </Button>
        </div>
      ) : sandboxes.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">该节点上暂无沙箱。</p>
      ) : (
        <TableContainer className="border-border/60 bg-transparent">
          <Table>
            <TableHeader className="static">
              <TableRow>
                <TableHead>沙箱</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">vCPU</TableHead>
                <TableHead className="text-right">内存 GiB</TableHead>
                <TableHead className="text-right">磁盘 GiB</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>启动时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sandboxesQuery.isFetching && !sandboxes.length ? (
                <TableSkeletonRows columns={SANDBOX_TABLE_COLUMNS} rows={2} />
              ) : (
                sandboxes.map((sandbox) => (
                  <TableRow key={sandbox.sandboxId}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm">{sandbox.name || sandbox.sandboxId.slice(0, 8)}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground" title={sandbox.sandboxId}>
                          {sandbox.sandboxId.slice(0, 8)}…
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <SandboxStateBadge state={sandbox.state} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(sandbox.cpu)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(sandbox.memoryGiB)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(sandbox.diskGiB)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(sandbox.createdAt)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sandbox.startedAt ? formatDateTime(sandbox.startedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  )
}
