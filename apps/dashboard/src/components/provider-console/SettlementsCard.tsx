/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmptyState,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getProviderApiErrorMessage } from '@/provider-api/client'
import {
  useProviderSettlementQuery,
  useProviderSettlementsQuery,
  useUpdateSettlementStatusMutation,
} from '@/provider-api/queries'
import type { ProviderSettlement, ProviderSettlementStatus } from '@/provider-api/types'
import { RefreshCw, ReceiptText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  SectionEmptyState,
  SectionErrorState,
  SettlementStatusBadge,
  TableSkeletonRows,
  formatCents,
  formatDateTime,
  formatNumber,
} from './shared'

const SETTLEMENT_TABLE_COLUMNS = 11

type SettlementStatusFilter = 'ALL' | Extract<ProviderSettlementStatus, 'PENDING' | 'SETTLED' | 'WITHDRAWN'>

const STATUS_FILTER_OPTIONS: Array<{ value: SettlementStatusFilter; label: string }> = [
  { value: 'ALL', label: '全部状态' },
  { value: 'PENDING', label: '待结算' },
  { value: 'SETTLED', label: '已结算' },
  { value: 'WITHDRAWN', label: '已提现' },
]

const ACTION_LABELS: Partial<Record<ProviderSettlementStatus, string>> = {
  WITHDRAWING: '申请提现',
  WITHDRAWN: '确认已到账',
}

const ACTION_CONFIRM_DESCRIPTIONS: Partial<Record<ProviderSettlementStatus, string>> = {
  WITHDRAWING: '确认对该结算单发起提现申请？发起后状态将变为「提现中」。',
  WITHDRAWN: '确认该结算单的提现已经到账？确认后状态将变为「已提现」，操作不可撤销。',
}

export function SettlementsCard({ isOwner }: { isOwner: boolean }) {
  const [statusFilter, setStatusFilter] = useState<SettlementStatusFilter>('ALL')
  const [detailSettlementId, setDetailSettlementId] = useState<string | null>(null)
  const [actionState, setActionState] = useState<{
    settlement: ProviderSettlement
    status: ProviderSettlementStatus
  } | null>(null)
  const [updatingSettlementId, setUpdatingSettlementId] = useState<string | null>(null)

  const settlementsQuery = useProviderSettlementsQuery({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
  })
  const updateSettlementStatusMutation = useUpdateSettlementStatusMutation()

  const settlements = useMemo(() => settlementsQuery.data?.items ?? [], [settlementsQuery.data])
  const currency = settlements[0]?.currency ?? 'CNY'

  const totals = useMemo(() => {
    return settlements.reduce(
      (acc, settlement) => {
        acc.cpuHours += settlement.cpuHours ?? 0
        acc.memoryGiBHours += settlement.memoryGiBHours ?? 0
        acc.diskGiBHours += settlement.diskGiBHours ?? 0
        acc.gpuHours += settlement.gpuHours ?? 0
        acc.amountCents += settlement.amountCents ?? 0
        acc.netCents += settlement.netCents ?? settlement.amountCents ?? 0
        return acc
      },
      { cpuHours: 0, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0, amountCents: 0, netCents: 0 },
    )
  }, [settlements])

  const handleConfirmAction = async () => {
    if (!actionState) {
      return
    }

    const { settlement, status } = actionState
    setUpdatingSettlementId(settlement.id)
    try {
      await updateSettlementStatusMutation.mutateAsync({ settlementId: settlement.id, status })
      toast.success(status === 'WITHDRAWING' ? '已提交提现申请' : '已确认提现到账')
      setActionState(null)
    } catch (error) {
      toast.error(getProviderApiErrorMessage(error, '更新结算状态失败'))
    } finally {
      setUpdatingSettlementId(null)
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium">结算单</h2>
          <span className="text-xs text-muted-foreground">按天生成，平台结算后可提现</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SettlementStatusFilter)}>
            <SelectTrigger size="sm" className="w-[132px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void settlementsQuery.refetch()}
            disabled={settlementsQuery.isFetching}
          >
            <RefreshCw className={settlementsQuery.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
            刷新
          </Button>
        </div>
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>结算周期</TableHead>
              <TableHead>节点</TableHead>
              <TableHead className="text-right">CPU·时</TableHead>
              <TableHead className="text-right">内存 GiB·时</TableHead>
              <TableHead className="text-right">磁盘 GiB·时</TableHead>
              <TableHead className="text-right">GPU·时</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead className="text-right">净收益</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>结算时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settlementsQuery.isLoading ? (
              <TableSkeletonRows columns={SETTLEMENT_TABLE_COLUMNS} rows={4} />
            ) : settlementsQuery.isError ? (
              <TableRow>
                <TableCell colSpan={SETTLEMENT_TABLE_COLUMNS} className="border-0">
                  <SectionErrorState
                    title="无法加载结算单"
                    description={getProviderApiErrorMessage(settlementsQuery.error, '请稍后重试或确认后端 API 已就绪')}
                    onRetry={() => void settlementsQuery.refetch()}
                    retrying={settlementsQuery.isFetching}
                  />
                </TableCell>
              </TableRow>
            ) : settlements.length === 0 ? (
              <TableEmptyState
                colSpan={SETTLEMENT_TABLE_COLUMNS}
                message="暂无结算单"
                icon={<ReceiptText />}
                description="每日结算任务运行后，这里会展示可提现的结算单。"
              />
            ) : (
              settlements.map((settlement) => {
                const isUpdating = updatingSettlementId === settlement.id
                const nextStatus: ProviderSettlementStatus | null =
                  isOwner && settlement.status === 'SETTLED'
                    ? 'WITHDRAWING'
                    : isOwner && settlement.status === 'WITHDRAWING'
                      ? 'WITHDRAWN'
                      : null

                return (
                  <TableRow key={settlement.id}>
                    <TableCell>
                      <span className="text-sm whitespace-nowrap">
                        {settlement.periodStart === settlement.periodEnd
                          ? settlement.periodStart
                          : `${settlement.periodStart} ~ ${settlement.periodEnd}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm" title={settlement.runnerName}>
                          {settlement.runnerName}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {settlement.runnerId.slice(0, 8)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(settlement.cpuHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(settlement.memoryGiBHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(settlement.diskGiBHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(settlement.gpuHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(settlement.amountCents, settlement.currency ?? currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(settlement.netCents ?? settlement.amountCents, settlement.currency ?? currency)}
                    </TableCell>
                    <TableCell>
                      <SettlementStatusBadge status={settlement.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {settlement.settledAt ? formatDateTime(settlement.settledAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailSettlementId(settlement.id)}
                          title="查看按沙箱拆分的结算明细"
                        >
                          明细
                        </Button>
                        {nextStatus ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => setActionState({ settlement, status: nextStatus })}
                          >
                            {isUpdating ? <Spinner /> : null}
                            {ACTION_LABELS[nextStatus]}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
          {settlements.length > 0 ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>合计（{settlements.length} 条）</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(totals.cpuHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(totals.memoryGiBHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(totals.diskGiBHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(totals.gpuHours)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCents(totals.amountCents, currency)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCents(totals.netCents, currency)}
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </TableContainer>

      <SettlementDetailDialog settlementId={detailSettlementId} onClose={() => setDetailSettlementId(null)} />

      <Dialog
        open={Boolean(actionState)}
        onOpenChange={(open) => {
          if (!open) {
            setActionState(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionState ? ACTION_LABELS[actionState.status] : '更新结算状态'}</DialogTitle>
            <DialogDescription>
              {actionState ? ACTION_CONFIRM_DESCRIPTIONS[actionState.status] : '确认要更新该结算单的状态吗？'}
            </DialogDescription>
          </DialogHeader>
          {actionState ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="font-medium">{actionState.settlement.runnerName}</div>
              <div className="text-xs text-muted-foreground">
                {actionState.settlement.periodStart} ~ {actionState.settlement.periodEnd} ·{' '}
                {formatCents(actionState.settlement.amountCents, actionState.settlement.currency ?? currency)}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                取消
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void handleConfirmAction()} disabled={Boolean(updatingSettlementId)}>
              {updatingSettlementId ? <Spinner /> : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function SettlementDetailDialog({ settlementId, onClose }: { settlementId: string | null; onClose: () => void }) {
  const detailQuery = useProviderSettlementQuery(settlementId)
  const detail = detailQuery.data
  const lines = detail?.lines ?? []
  const currency = detail?.currency ?? 'CNY'

  const renderContent = () => {
    if (detailQuery.isLoading) {
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      )
    }

    if (detailQuery.isError) {
      return (
        <SectionErrorState
          title="无法加载结算明细"
          description={getProviderApiErrorMessage(detailQuery.error, '请稍后重试')}
          onRetry={() => void detailQuery.refetch()}
          retrying={detailQuery.isFetching}
        />
      )
    }

    if (lines.length === 0) {
      return <SectionEmptyState title="暂无沙箱明细" description="该结算单没有按沙箱拆分的用量记录。" />
    }

    return (
      <TableContainer className="max-h-[50vh]">
        <Table>
          <TableHeader className="static">
            <TableRow>
              <TableHead>沙箱 ID</TableHead>
              <TableHead className="text-right">CPU·时</TableHead>
              <TableHead className="text-right">内存 GiB·时</TableHead>
              <TableHead className="text-right">磁盘 GiB·时</TableHead>
              <TableHead className="text-right">GPU·时</TableHead>
              <TableHead className="text-right">金额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.sandboxId}>
                <TableCell>
                  <span className="font-mono text-xs" title={line.sandboxId}>
                    {line.sandboxId.slice(0, 8)}…
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(line.cpuHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(line.memoryGiBHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(line.diskGiBHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(line.gpuHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(line.amountCents, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <Dialog
      open={Boolean(settlementId)}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>结算明细</DialogTitle>
          <DialogDescription>
            {detail ? `${detail.runnerName} · ${detail.periodStart} ~ ${detail.periodEnd}` : '按沙箱拆分的用量与金额。'}
          </DialogDescription>
        </DialogHeader>
        {renderContent()}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              关闭
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
