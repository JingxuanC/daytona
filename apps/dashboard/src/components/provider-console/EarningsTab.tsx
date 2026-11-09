/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Button } from '@/components/ui/button'
import { DateRangePicker, type QuickRangesConfig } from '@/components/ui/date-range-picker'
import { Separator } from '@/components/ui/separator'
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
import { format, startOfDay, subDays } from 'date-fns'
import { Coins, Settings2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { getProviderApiErrorMessage } from '@/provider-api/client'
import { useProviderEarningsQuery } from '@/provider-api/queries'
import { PricingDialog } from './PricingDialog'
import { SettlementsCard } from './SettlementsCard'
import { SectionErrorState, TableSkeletonRows, formatCents, formatNumber } from './shared'

const EARNINGS_TABLE_COLUMNS = 7

const EARNINGS_QUICK_RANGES: QuickRangesConfig = {
  days: [7, 14, 30, 90],
}

function createDefaultDateRange(): DateRange {
  const today = startOfDay(new Date())
  return { from: startOfDay(subDays(today, 6)), to: today }
}

export function EarningsTab({ writePermitted, isOwner }: { writePermitted: boolean; isOwner: boolean }) {
  const [dateRange, setDateRange] = useState<DateRange>(createDefaultDateRange)
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false)

  const earningsQueryParams = useMemo(() => {
    if (!dateRange.from || !dateRange.to) {
      return null
    }

    return {
      from: format(dateRange.from, 'yyyy-MM-dd'),
      to: format(dateRange.to, 'yyyy-MM-dd'),
    }
  }, [dateRange])

  const earningsQuery = useProviderEarningsQuery(earningsQueryParams)

  const handleDateRangeChange = useCallback((range: DateRange) => {
    if (!range.from || !range.to) {
      setDateRange(range)
      return
    }

    setDateRange(range.from > range.to ? { from: range.to, to: range.from } : range)
  }, [])

  const items = useMemo(() => {
    const source = earningsQuery.data?.items ?? []
    return [...source].sort((left, right) => {
      const dateCompare = (right.date ?? '').localeCompare(left.date ?? '')
      return dateCompare !== 0 ? dateCompare : left.runnerName.localeCompare(right.runnerName, 'zh-CN')
    })
  }, [earningsQuery.data])

  const totals = earningsQuery.data?.totals
  const currency = earningsQuery.data?.currency ?? 'CNY'
  const hasData = items.length > 0

  return (
    <div className="flex flex-col gap-8">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-medium">收益明细</h2>
            <span className="text-xs text-muted-foreground">按节点 × 天统计</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={dateRange}
              onChange={handleDateRangeChange}
              quickRangesEnabled
              quickRanges={EARNINGS_QUICK_RANGES}
              timeSelection={false}
              contentAlign="end"
              className="w-auto"
            />
            <Button variant="outline" size="sm" onClick={() => setPricingDialogOpen(true)}>
              <Settings2 className="size-4" />
              定价设置
            </Button>
          </div>
        </div>

        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead>节点</TableHead>
                <TableHead className="text-right">CPU·时</TableHead>
                <TableHead className="text-right">内存 GiB·时</TableHead>
                <TableHead className="text-right">磁盘 GiB·时</TableHead>
                <TableHead className="text-right">GPU·时</TableHead>
                <TableHead className="text-right">金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earningsQuery.isLoading ? (
                <TableSkeletonRows columns={EARNINGS_TABLE_COLUMNS} rows={5} />
              ) : earningsQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={EARNINGS_TABLE_COLUMNS} className="border-0">
                    <SectionErrorState
                      title="无法加载收益数据"
                      description={getProviderApiErrorMessage(earningsQuery.error, '请稍后重试或确认后端 API 已就绪')}
                      onRetry={() => void earningsQuery.refetch()}
                      retrying={earningsQuery.isFetching}
                    />
                  </TableCell>
                </TableRow>
              ) : !hasData ? (
                <TableEmptyState
                  colSpan={EARNINGS_TABLE_COLUMNS}
                  message="暂无收益数据"
                  icon={<Coins />}
                  description="所选时间范围内尚无已结算或可估算的用量收益。"
                />
              ) : (
                items.map((item) => (
                  <TableRow key={`${item.date}-${item.runnerId ?? 'unattributed'}`}>
                    <TableCell className="text-sm whitespace-nowrap">{item.date}</TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm" title={item.runnerName}>
                          {item.runnerName}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {item.runnerId ? `${item.runnerId.slice(0, 8)}…` : '未归属节点'}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.cpuHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.memoryGiBHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.diskGiBHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.gpuHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(item.amountCents, currency)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {hasData && totals ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>合计</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totals.cpuHours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totals.memoryGiBHours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totals.diskGiBHours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totals.gpuHours)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCents(totals.amountCents, currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </TableContainer>

        <p className="text-xs text-muted-foreground">
          金额以结算落库数据为准；当天尚未生成结算单的部分按当前定价实时估算。
        </p>
      </section>

      <Separator />

      <SettlementsCard isOwner={isOwner} />

      <PricingDialog open={pricingDialogOpen} onOpenChange={setPricingDialogOpen} writePermitted={writePermitted} />
    </div>
  )
}
