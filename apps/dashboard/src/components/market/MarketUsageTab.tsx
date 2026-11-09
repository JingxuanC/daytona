/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { getMarketApiErrorMessage } from '@/market-api/client'
import { useMarketUsageQuery } from '@/market-api/queries'
import { useState } from 'react'

const COLUMNS = 7

function defaultRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000)
  const toLabel = (date: Date) => date.toISOString().slice(0, 10)
  return { from: toLabel(from), to: toLabel(to) }
}

function formatAmount(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

export function MarketUsageTab() {
  const [range, setRange] = useState(defaultRange)
  const { data, isLoading, error } = useMarketUsageQuery(range)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="market-usage-from">开始日期</Label>
          <Input
            id="market-usage-from"
            type="date"
            value={range.from}
            onChange={(event) => setRange((prev) => ({ ...prev, from: event.target.value }))}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="market-usage-to">结束日期</Label>
          <Input
            id="market-usage-to"
            type="date"
            value={range.to}
            onChange={(event) => setRange((prev) => ({ ...prev, to: event.target.value }))}
          />
        </div>
        <Button variant="outline" onClick={() => setRange(defaultRange())}>
          最近 7 天
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {getMarketApiErrorMessage(error)}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>应付金额（M1 展示，不扣款）</CardDescription>
            <CardTitle className="text-2xl">{formatAmount(data?.totals.amountCents ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>用量</CardDescription>
            <CardTitle className="text-lg">
              {(data?.totals.cpuHours ?? 0).toFixed(4)} vCPU·h · {(data?.totals.memoryGiBHours ?? 0).toFixed(4)} GiB·h
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            磁盘 {(data?.totals.diskGiBHours ?? 0).toFixed(4)} GiB·h
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>计价方式</CardDescription>
            <CardTitle className="text-lg">按租约价格快照</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">提供方后续调价不影响已生效租约</CardContent>
        </Card>
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>算力</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>vCPU·h</TableHead>
              <TableHead>内存 GiB·h</TableHead>
              <TableHead>磁盘 GiB·h</TableHead>
              <TableHead className="text-right">金额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="py-6 text-center">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : data?.items.length ? (
              data.items.map((item) => (
                <TableRow key={`${item.date}-${item.regionId}`}>
                  <TableCell className="text-sm">{item.date}</TableCell>
                  <TableCell className="text-sm">{item.listingName ?? item.listingId}</TableCell>
                  <TableCell className="text-sm">{item.regionName ?? item.regionId}</TableCell>
                  <TableCell className="text-sm">{item.cpuHours.toFixed(4)}</TableCell>
                  <TableCell className="text-sm">{item.memoryGiBHours.toFixed(4)}</TableCell>
                  <TableCell className="text-sm">{item.diskGiBHours.toFixed(4)}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatAmount(item.amountCents)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState colSpan={COLUMNS} message="该时间范围内没有市场用量" />
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  )
}
