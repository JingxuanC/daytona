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
import { useCloseMarketLeaseMutation, useMarketLeasesQuery } from '@/market-api/queries'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

const COLUMNS = 7

function formatPrice(centsPerHour: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${(centsPerHour / 100).toFixed(2)}/h`
}

export function MyLeasesTab({ writePermitted }: { writePermitted: boolean }) {
  const { data, isLoading, error, refetch, isFetching } = useMarketLeasesQuery()
  const closeLease = useCloseMarketLeaseMutation()

  const handleClose = async (leaseId: string) => {
    try {
      await closeLease.mutateAsync(leaseId)
      toast.success('租约已关闭，配额已回收')
    } catch (err) {
      toast.error(getMarketApiErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          本组织持有的市场租约。关闭租约会回收对应 region 的配额（已存在的沙箱不受影响）。
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className="mr-1 size-4" />
          刷新
        </Button>
      </div>

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
              <TableHead>配额</TableHead>
              <TableHead>价格（快照）</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
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
              data.items.map((lease) => (
                <TableRow key={lease.id}>
                  <TableCell className="font-medium">{lease.listingName ?? lease.listingId}</TableCell>
                  <TableCell className="text-sm">{lease.regionName ?? lease.regionId}</TableCell>
                  <TableCell className="text-sm">
                    {lease.totalCpu} vCPU · {lease.totalMemoryGiB} GiB · {lease.totalDiskGiB} GiB
                  </TableCell>
                  <TableCell className="text-sm">
                    vCPU {formatPrice(lease.cpuHourCents, lease.currency)} · 内存{' '}
                    {formatPrice(lease.memoryGiBHourCents, lease.currency)} · 磁盘{' '}
                    {formatPrice(lease.diskGiBHourCents, lease.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={lease.status === 'active' ? 'success' : 'outline'}>
                      {lease.status === 'active' ? '生效中' : '已关闭'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(lease.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {lease.status === 'active' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!writePermitted || closeLease.isPending}
                        onClick={() => handleClose(lease.id)}
                      >
                        关闭
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState colSpan={COLUMNS} message="还没有租约，去「算力市场」租一台吧" />
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  )
}
