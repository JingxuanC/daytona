/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import QuotaLine from '@/components/QuotaLine'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { CircleAlert, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  ProviderAlertSeverity,
  ProviderAlertType,
  ProviderSettlementStatus,
} from '@/provider-api/types'

const currencyFormatterCache = new Map<string, Intl.NumberFormat>()

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
  const normalized = currency || 'CNY'
  const cached = currencyFormatterCache.get(normalized)
  if (cached) {
    return cached
  }

  let formatter: Intl.NumberFormat
  try {
    formatter = new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } catch {
    // 非法币种代码时降级为纯数字金额，避免整页渲染报错
    formatter = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  currencyFormatterCache.set(normalized, formatter)
  return formatter
}

/** 整数分 => 展示金额（默认人民币元） */
export function formatCents(cents: number | null | undefined, currency = 'CNY'): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '—'
  }

  return getCurrencyFormatter(currency).format(cents / 100)
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(value)
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  return `${value.toFixed(fractionDigits)}%`
}

/** 中文相对时间，例如“5 分钟前”“2 天前” */
export function formatRelativeTime(timestamp?: string | null, fallback = '—'): string {
  if (!timestamp) {
    return fallback
  }

  const date = new Date(timestamp)
  const time = date.getTime()
  if (Number.isNaN(time)) {
    return fallback
  }

  const diffMs = Date.now() - time
  const isFuture = diffMs < 0
  const absSeconds = Math.floor(Math.abs(diffMs) / 1000)

  if (absSeconds < 60) {
    return isFuture ? '即将' : '刚刚'
  }

  const minutes = Math.floor(absSeconds / 60)
  if (minutes < 60) {
    return isFuture ? `${minutes} 分钟后` : `${minutes} 分钟前`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return isFuture ? `${hours} 小时后` : `${hours} 小时前`
  }

  const days = Math.floor(hours / 24)
  if (days < 30) {
    return isFuture ? `${days} 天后` : `${days} 天前`
  }

  const months = Math.floor(days / 30)
  if (months < 12) {
    return isFuture ? `${months} 个月后` : `${months} 个月前`
  }

  const years = Math.floor(months / 12)
  return isFuture ? `${years} 年后` : `${years} 年前`
}

/** 绝对时间，例如 2026-11-09 20:30 */
export function formatDateTime(timestamp?: string | null, fallback = '—'): string {
  if (!timestamp) {
    return fallback
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }

  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

/** 7 日成功率（0-100），无启动记录时返回 null */
export function getSuccessRate(starts: number | null | undefined, failures: number | null | undefined): number | null {
  if (!Number.isFinite(starts) || !starts || starts <= 0) {
    return null
  }

  const failed = Math.min(Math.max(failures ?? 0, 0), starts)
  return ((starts - failed) / starts) * 100
}

interface StatusMeta {
  label: string
  variant: BadgeProps['variant']
}

const NODE_STATE_META: Record<string, StatusMeta> = {
  ready: { label: '在线', variant: 'success' },
  unresponsive: { label: '未响应', variant: 'destructive' },
  initializing: { label: '初始化中', variant: 'warning' },
  disabled: { label: '已禁用', variant: 'secondary' },
  decommissioned: { label: '已下线', variant: 'secondary' },
}

export function getNodeStateMeta(state: string | null | undefined): StatusMeta {
  if (!state) {
    return { label: '未知', variant: 'secondary' }
  }

  return NODE_STATE_META[state] ?? { label: state, variant: 'secondary' }
}

export function NodeStateBadges({
  state,
  unschedulable,
}: {
  state: string | null | undefined
  unschedulable?: boolean
}) {
  const meta = getNodeStateMeta(state)

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={meta.variant}>{meta.label}</Badge>
      {unschedulable ? (
        <Badge variant="outline" className="text-muted-foreground">
          不可调度
        </Badge>
      ) : null}
    </div>
  )
}

const SANDBOX_STATE_META: Record<string, StatusMeta> = {
  started: { label: '运行中', variant: 'success' },
  stopped: { label: '已停止', variant: 'secondary' },
  starting: { label: '启动中', variant: 'warning' },
  stopping: { label: '停止中', variant: 'warning' },
  creating: { label: '创建中', variant: 'warning' },
  error: { label: '异常', variant: 'destructive' },
  archiving: { label: '归档中', variant: 'warning' },
  archived: { label: '已归档', variant: 'secondary' },
  restoring: { label: '恢复中', variant: 'warning' },
  destroying: { label: '销毁中', variant: 'warning' },
  destroyed: { label: '已销毁', variant: 'secondary' },
}

export function SandboxStateBadge({ state }: { state: string | null | undefined }) {
  const meta = state ? SANDBOX_STATE_META[state] : undefined

  return <Badge variant={meta?.variant ?? 'secondary'}>{meta?.label ?? state ?? '未知'}</Badge>
}

const SETTLEMENT_STATUS_META: Record<ProviderSettlementStatus, StatusMeta> = {
  PENDING: { label: '待结算', variant: 'warning' },
  SETTLED: { label: '已结算', variant: 'success' },
  WITHDRAWING: { label: '提现中', variant: 'info' },
  WITHDRAWN: { label: '已提现', variant: 'secondary' },
}

export function getSettlementStatusMeta(status: ProviderSettlementStatus): StatusMeta {
  return SETTLEMENT_STATUS_META[status] ?? { label: status, variant: 'secondary' }
}

export function SettlementStatusBadge({ status }: { status: ProviderSettlementStatus }) {
  const meta = getSettlementStatusMeta(status)

  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

const ALERT_TYPE_LABELS: Record<ProviderAlertType, string> = {
  OFFLINE: '节点离线',
  HEALTHCHECK_FAILED: '健康检查失败',
  HIGH_LATENCY: '延迟过高',
  RESOURCE_PRESSURE: '资源压力',
}

export function getAlertTypeLabel(type: string | null | undefined): string {
  if (!type) {
    return '未知'
  }

  return ALERT_TYPE_LABELS[type as ProviderAlertType] ?? type
}

const ALERT_SEVERITY_META: Record<ProviderAlertSeverity, StatusMeta> = {
  WARNING: { label: '警告', variant: 'warning' },
  CRITICAL: { label: '严重', variant: 'destructive' },
}

export function AlertSeverityBadge({ severity }: { severity: ProviderAlertSeverity }) {
  const meta = ALERT_SEVERITY_META[severity] ?? { label: severity, variant: 'secondary' }

  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

/** 资源水位条：绿色 → 黄色 → 红色渐变，右侧显示百分比 */
export function UsageBar({ pct, className }: { pct: number | null | undefined; className?: string }) {
  const safePct = typeof pct === 'number' && Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) : 0

  return (
    <div className={cn('flex min-w-[110px] items-center gap-2', className)}>
      <QuotaLine current={safePct} total={100} className="h-1.5 flex-1" />
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatPercent(pct)}
      </span>
    </div>
  )
}

export function TableSkeletonRows({ rows = 3, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <TableCell key={columnIndex}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

export function SectionErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  className,
}: {
  title: string
  description?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <div className="flex size-9 items-center justify-center rounded-lg bg-destructive-background text-destructive-foreground">
        <CircleAlert className="size-4" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="max-w-md text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? <Spinner /> : <RefreshCw className="size-3.5" />}
          重试
        </Button>
      ) : null}
    </div>
  )
}

export function SectionEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('border-0 bg-transparent py-10', className)}>
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
