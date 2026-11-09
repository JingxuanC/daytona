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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getProviderApiErrorMessage } from '@/provider-api/client'
import { useProviderPricingQuery, useUpdateProviderPricingMutation } from '@/provider-api/queries'
import type { ProviderPricingItem, UpdateProviderPricingPayload } from '@/provider-api/types'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SectionErrorState, SectionEmptyState } from './shared'

interface PricingDraft {
  cpu: string
  memory: string
  disk: string
  gpu: string
}

type PricingDraftField = keyof PricingDraft

const EMPTY_DRAFT: PricingDraft = { cpu: '0', memory: '0', disk: '0', gpu: '0' }

function centsToInputValue(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '0'
  }

  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}

function inputValueToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) {
    return null
  }

  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
}

function createDraft(item: ProviderPricingItem): PricingDraft {
  return {
    cpu: centsToInputValue(item.cpuHourCents),
    memory: centsToInputValue(item.memoryGiBHourCents),
    disk: centsToInputValue(item.diskGiBHourCents),
    gpu: centsToInputValue(item.gpuHourCents),
  }
}

export function PricingDialog({
  open,
  onOpenChange,
  writePermitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  writePermitted: boolean
}) {
  const pricingQuery = useProviderPricingQuery(open)
  const updatePricingMutation = useUpdateProviderPricingMutation()

  const [drafts, setDrafts] = useState<Record<string, PricingDraft>>({})
  const [savingRunnerId, setSavingRunnerId] = useState<string | null>(null)

  const items = useMemo(() => pricingQuery.data?.items ?? [], [pricingQuery.data])
  const currency = pricingQuery.data?.currency ?? 'CNY'

  useEffect(() => {
    if (!open || !pricingQuery.data?.items) {
      return
    }

    setDrafts(Object.fromEntries(pricingQuery.data.items.map((item) => [item.runnerId, createDraft(item)])))
  }, [open, pricingQuery.data])

  const handleDraftChange = (runnerId: string, field: PricingDraftField, value: string) => {
    setDrafts((previous) => ({
      ...previous,
      [runnerId]: {
        ...(previous[runnerId] ?? EMPTY_DRAFT),
        [field]: value,
      },
    }))
  }

  const handleSave = async (item: ProviderPricingItem) => {
    if (!writePermitted) {
      return
    }

    const draft = drafts[item.runnerId] ?? EMPTY_DRAFT
    const cpuHourCents = inputValueToCents(draft.cpu)
    const memoryGiBHourCents = inputValueToCents(draft.memory)
    const diskGiBHourCents = inputValueToCents(draft.disk)
    const gpuHourCents = inputValueToCents(draft.gpu)

    if (
      cpuHourCents === null ||
      memoryGiBHourCents === null ||
      diskGiBHourCents === null ||
      gpuHourCents === null
    ) {
      toast.error('请填写不小于 0 的金额，最多保留两位小数')
      return
    }

    const payload: UpdateProviderPricingPayload = {
      cpuHourCents,
      memoryGiBHourCents,
      diskGiBHourCents,
      gpuHourCents,
    }

    setSavingRunnerId(item.runnerId)
    try {
      await updatePricingMutation.mutateAsync({ runnerId: item.runnerId, payload })
      toast.success(`已保存「${item.runnerName}」的定价`)
    } catch (error) {
      toast.error(getProviderApiErrorMessage(error, '保存定价失败'))
    } finally {
      setSavingRunnerId(null)
    }
  }

  const renderContent = () => {
    if (pricingQuery.isLoading) {
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )
    }

    if (pricingQuery.isError) {
      return (
        <SectionErrorState
          title="无法加载节点定价"
          description={getProviderApiErrorMessage(pricingQuery.error, '请稍后重试或确认后端 API 已就绪')}
          onRetry={() => void pricingQuery.refetch()}
          retrying={pricingQuery.isFetching}
        />
      )
    }

    if (items.length === 0) {
      return <SectionEmptyState title="暂无可定价的节点" description="组织内注册节点后可在此设置计费单价。" />
    }

    return (
      <TableContainer className="max-h-[50vh]">
        <Table>
          <TableHeader className="static">
            <TableRow>
              <TableHead>节点</TableHead>
              <TableHead className="text-right">vCPU·时（元）</TableHead>
              <TableHead className="text-right">内存 GiB·时（元）</TableHead>
              <TableHead className="text-right">磁盘 GiB·时（元）</TableHead>
              <TableHead className="text-right">GPU·时（元）</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const draft = drafts[item.runnerId] ?? EMPTY_DRAFT
              const isSaving = savingRunnerId === item.runnerId

              return (
                <TableRow key={item.runnerId}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" title={item.runnerName}>
                        {item.runnerName}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground" title={item.runnerId}>
                        {item.runnerId.slice(0, 8)}
                      </div>
                    </div>
                  </TableCell>
                  <PricingInputCell
                    value={draft.cpu}
                    onChange={(value) => handleDraftChange(item.runnerId, 'cpu', value)}
                    disabled={!writePermitted || isSaving}
                  />
                  <PricingInputCell
                    value={draft.memory}
                    onChange={(value) => handleDraftChange(item.runnerId, 'memory', value)}
                    disabled={!writePermitted || isSaving}
                  />
                  <PricingInputCell
                    value={draft.disk}
                    onChange={(value) => handleDraftChange(item.runnerId, 'disk', value)}
                    disabled={!writePermitted || isSaving}
                  />
                  <PricingInputCell
                    value={draft.gpu}
                    onChange={(value) => handleDraftChange(item.runnerId, 'gpu', value)}
                    disabled={!writePermitted || isSaving}
                  />
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSave(item)}
                      disabled={!writePermitted || isSaving}
                    >
                      {isSaving ? <Spinner /> : null}
                      保存
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>节点定价</DialogTitle>
          <DialogDescription>
            按实际用量计费，单价以元为单位、保存时换算为整数分（{currency}）。未设置过定价的节点默认按 0 计。
          </DialogDescription>
        </DialogHeader>
        {!writePermitted ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            当前账号没有 Runner 写入权限，定价仅可查看。
          </p>
        ) : null}
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

function PricingInputCell({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <TableCell className="text-right">
      <Input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-24 text-right tabular-nums"
      />
    </TableCell>
  )
}
