/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Badge } from '@/components/ui/badge'
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
import { useMarketChargesQuery, useMarketCreditQuery } from '@/market-api/queries'
import { useState } from 'react'

const ENTRY_COLUMNS = 4
const CHARGE_COLUMNS = 6

function defaultRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000)
  const toLabel = (date: Date) => date.toISOString().slice(0, 10)
  return { from: toLabel(from), to: toLabel(to) }
}

function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}¥${(Math.abs(cents) / 100).toFixed(2)}`
}

export function MarketAccountTab() {
  const creditQuery = useMarketCreditQuery()
  const [range, setRange] = useState(defaultRange)
  const chargesQuery = useMarketChargesQuery(range)

  const credit = creditQuery.data
  const balance = credit?.balanceCents ?? 0
  const entries = credit?.entries ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>账户余额</CardDescription>
            <CardTitle className="text-2xl">{formatAmount(balance)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {balance < 0 ? '余额为负：新租约与市场 region 上的新沙箱将被拒绝' : '用于支付市场算力消费'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>本期已扣费</CardDescription>
            <CardTitle className="text-2xl">
              {formatAmount((chargesQuery.data?.items ?? []).reduce((acc, item) => acc + item.amountCents, 0))}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            平台服务费{' '}
            {formatAmount((chargesQuery.data?.items ?? []).reduce((acc, item) => acc + item.platformFeeCents, 0))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>扣费规则</CardDescription>
            <CardTitle className="text-lg">每日 01:30 UTC</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            按租约价格快照对前一 UTC 日用量扣费；充值需平台管理员操作（自托管 M2）
          </CardContent>
        </Card>
      </div>

      {creditQuery.error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {getMarketApiErrorMessage(creditQuery.error)}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">最近流水</h3>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead className="text-right">金额 / 余额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={ENTRY_COLUMNS} className="py-6 text-center">
                      <Spinner className="mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : entries.length ? (
                  entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={entry.amountCents >= 0 ? 'success' : 'outline'}>
                          {entry.amountCents >= 0 ? '充值' : '扣费'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm" title={entry.description ?? ''}>
                        {entry.description ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        <div>{formatAmount(entry.amountCents)}</div>
                        <div className="text-xs text-muted-foreground">
                          余额 {formatAmount(entry.balanceAfterCents)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmptyState colSpan={ENTRY_COLUMNS} message="暂无流水" />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 className="text-sm font-medium">用量扣费</h3>
            <div className="flex items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="charge-from" className="text-xs">
                  开始
                </Label>
                <Input
                  id="charge-from"
                  type="date"
                  className="h-8"
                  value={range.from}
                  onChange={(event) => setRange((prev) => ({ ...prev, from: event.target.value }))}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="charge-to" className="text-xs">
                  结束
                </Label>
                <Input
                  id="charge-to"
                  type="date"
                  className="h-8"
                  value={range.to}
                  onChange={(event) => setRange((prev) => ({ ...prev, to: event.target.value }))}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => setRange(defaultRange())}>
                最近 7 天
              </Button>
            </div>
          </div>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>算力</TableHead>
                  <TableHead>用量</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead className="text-right">平台费</TableHead>
                  <TableHead className="text-right">提供方净收益</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chargesQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={CHARGE_COLUMNS} className="py-6 text-center">
                      <Spinner className="mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : chargesQuery.data?.items.length ? (
                  chargesQuery.data.items.map((charge) => (
                    <TableRow key={charge.id}>
                      <TableCell className="text-sm">{charge.periodStart}</TableCell>
                      <TableCell className="text-sm">{charge.listingName ?? charge.listingId.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">
                        {charge.cpuHours.toFixed(4)} vCPU·h · {charge.memoryGiBHours.toFixed(4)} GiB·h
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatAmount(charge.amountCents)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {charge.platformFeeCents > 0 ? formatAmount(charge.platformFeeCents) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatAmount(charge.providerNetCents)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmptyState colSpan={CHARGE_COLUMNS} message="暂无扣费记录" />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      </div>
    </div>
  )
}
