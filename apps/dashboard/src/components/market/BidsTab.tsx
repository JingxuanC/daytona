/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Badge } from '@/components/ui/badge'
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
import { getMarketApiErrorMessage } from '@/market-api/client'
import { useMarketBidsQuery, useWithdrawMarketBidMutation } from '@/market-api/queries'
import type { MarketBidStatus } from '@/market-api/types'
import { toast } from 'sonner'

const COLUMNS = 7

const STATUS_LABELS: Record<MarketBidStatus, string> = {
  pending: '待提供方处理',
  accepted: '已接受',
  rejected: '已拒绝',
  withdrawn: '已撤回',
}

function formatPrice(centsPerHour: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${(centsPerHour / 100).toFixed(2)}/h`
}

export function BidsTab({ writePermitted }: { writePermitted: boolean }) {
  const { data, isLoading, error } = useMarketBidsQuery()
  const withdraw = useWithdrawMarketBidMutation()

  const handleWithdraw = async (bidId: string) => {
    try {
      await withdraw.mutateAsync(bidId)
      toast.success('出价已撤回')
    } catch (err) {
      toast.error(getMarketApiErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        出价后由提供方接受或拒绝；接受时按出价生成租约（价格以出价快照为准）。在「浏览算力」里点「出价」提交。
      </p>
      {error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {getMarketApiErrorMessage(error)}
        </div>
      ) : null}
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>算力</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>出价</TableHead>
              <TableHead>容量</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>提交时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
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
              data.items.map((bid) => (
                <TableRow key={bid.id}>
                  <TableCell className="font-medium">{bid.listingName ?? bid.listingId.slice(0, 8)}</TableCell>
                  <TableCell className="text-sm">{bid.regionId ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {formatPrice(bid.cpuHourCents, bid.currency)} · {formatPrice(bid.memoryGiBHourCents, bid.currency)}{' '}
                    · {formatPrice(bid.diskGiBHourCents, bid.currency)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {bid.totalCpu} vCPU · {bid.totalMemoryGiB} GiB · {bid.totalDiskGiB} GiB
                  </TableCell>
                  <TableCell>
                    <Badge variant={bid.status === 'accepted' ? 'success' : 'outline'}>
                      {STATUS_LABELS[bid.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(bid.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {bid.status === 'pending' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!writePermitted || withdraw.isPending}
                        onClick={() => handleWithdraw(bid.id)}
                      >
                        撤回
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState colSpan={COLUMNS} message="还没有出价，去「浏览算力」里点「出价」" />
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  )
}
