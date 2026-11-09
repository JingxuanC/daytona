/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { useCreateMarketBidMutation, useMarketListingsQuery, useOpenMarketLeaseMutation } from '@/market-api/queries'
import type { MarketListing, MarketListingSort } from '@/market-api/types'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

const COLUMNS = 9

function formatPrice(centsPerHour: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${(centsPerHour / 100).toFixed(2)}/h`
}

export function MarketBrowseTab({ writePermitted }: { writePermitted: boolean }) {
  const [sort, setSort] = useState<MarketListingSort>('newest')
  const { data, isLoading, error, refetch, isFetching } = useMarketListingsQuery(sort)
  const openLease = useOpenMarketLeaseMutation()
  const createBid = useCreateMarketBidMutation()
  const [selected, setSelected] = useState<MarketListing | null>(null)
  const [bidTarget, setBidTarget] = useState<MarketListing | null>(null)
  const [bidCpu, setBidCpu] = useState('')
  const [bidMemory, setBidMemory] = useState('')
  const [bidCpuPrice, setBidCpuPrice] = useState('80')
  const [cpu, setCpu] = useState('')
  const [memory, setMemory] = useState('')
  const [disk, setDisk] = useState('')

  const handleLease = async () => {
    if (!selected) {
      return
    }
    try {
      await openLease.mutateAsync({
        listingId: selected.id,
        totalCpu: cpu ? Number(cpu) : undefined,
        totalMemoryGiB: memory ? Number(memory) : undefined,
        totalDiskGiB: disk ? Number(disk) : undefined,
      })
      toast.success('租用成功：该 region 已加入可用列表')
      setSelected(null)
      setCpu('')
      setMemory('')
      setDisk('')
    } catch (err) {
      toast.error(getMarketApiErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          平台上的算力供给（价格来自提供方上架时的定价）。租用后即可在创建沙箱时选择对应 region。
        </p>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(value) => setSort(value as MarketListingSort)}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">最新上架</SelectItem>
              <SelectItem value="price_asc">价格从低到高</SelectItem>
              <SelectItem value="price_desc">价格从高到低</SelectItem>
              <SelectItem value="capacity_desc">容量优先</SelectItem>
              <SelectItem value="reputation_desc">信誉优先</SelectItem>
              <SelectItem value="success_rate_desc">启动成功率优先</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className="mr-1 size-4" />
            刷新
          </Button>
        </div>
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
              <TableHead>vCPU</TableHead>
              <TableHead>内存</TableHead>
              <TableHead>磁盘</TableHead>
              <TableHead>租约</TableHead>
              <TableHead>评分</TableHead>
              <TableHead>成功率</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="py-6 text-center text-sm text-muted-foreground">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : data?.items.length ? (
              data.items.map((listing) => (
                <TableRow key={listing.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{listing.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatPrice(listing.cpuHourCents, listing.currency)} · 内存{' '}
                        {formatPrice(listing.memoryGiBHourCents, listing.currency)} · 磁盘{' '}
                        {formatPrice(listing.diskGiBHourCents, listing.currency)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{listing.regionName ?? listing.regionId}</TableCell>
                  <TableCell className="text-sm">{listing.totalCpu}</TableCell>
                  <TableCell className="text-sm">{listing.totalMemoryGiB} GiB</TableCell>
                  <TableCell className="text-sm">{listing.totalDiskGiB} GiB</TableCell>
                  <TableCell className="text-sm">{listing.activeLeaseCount ?? 0}</TableCell>
                  <TableCell className="text-sm">
                    {listing.reputation ? `${listing.reputation.availabilityScore.toFixed(1)}` : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {listing.reputation?.startupSuccessRatePct != null
                      ? `${listing.reputation.startupSuccessRatePct.toFixed(1)}%`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={!writePermitted || openLease.isPending}
                        onClick={() => setSelected(listing)}
                      >
                        租用
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!writePermitted || createBid.isPending}
                        onClick={() => {
                          setBidTarget(listing)
                          setBidCpu('')
                          setBidMemory('')
                          setBidCpuPrice('80')
                        }}
                      >
                        出价
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState colSpan={COLUMNS} message="还没有可租用的算力供给" />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>租用算力</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.name}（${selected.regionName ?? selected.regionId}）` : ''}
              。留空则按上架容量全额租用。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="lease-cpu">vCPU（最大 {selected?.totalCpu ?? 0}）</Label>
              <Input
                id="lease-cpu"
                type="number"
                min={1}
                max={selected?.totalCpu}
                value={cpu}
                placeholder={String(selected?.totalCpu ?? '')}
                onChange={(event) => setCpu(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="lease-memory">内存 GiB（最大 {selected?.totalMemoryGiB ?? 0}）</Label>
              <Input
                id="lease-memory"
                type="number"
                min={1}
                max={selected?.totalMemoryGiB}
                value={memory}
                placeholder={String(selected?.totalMemoryGiB ?? '')}
                onChange={(event) => setMemory(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="lease-disk">磁盘 GiB（最大 {selected?.totalDiskGiB ?? 0}）</Label>
              <Input
                id="lease-disk"
                type="number"
                min={1}
                max={selected?.totalDiskGiB}
                value={disk}
                placeholder={String(selected?.totalDiskGiB ?? '')}
                onChange={(event) => setDisk(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              取消
            </Button>
            <Button onClick={handleLease} disabled={openLease.isPending}>
              {openLease.isPending ? <Spinner /> : '确认租用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(bidTarget)} onOpenChange={(open) => !open && setBidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交出价</DialogTitle>
            <DialogDescription>
              为 {bidTarget?.name ?? ''} 出价，提供方接受后按出价生成租约（价格以出价快照为准）。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="bid-cpu-price">vCPU 出价（分/小时）</Label>
                <Input
                  id="bid-cpu-price"
                  type="number"
                  min={0}
                  value={bidCpuPrice}
                  onChange={(event) => setBidCpuPrice(event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="bid-cpu">vCPU 数量</Label>
                <Input
                  id="bid-cpu"
                  type="number"
                  min={1}
                  max={bidTarget?.totalCpu}
                  value={bidCpu}
                  placeholder={String(bidTarget?.totalCpu ?? '')}
                  onChange={(event) => setBidCpu(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="bid-memory">内存 GiB</Label>
              <Input
                id="bid-memory"
                type="number"
                min={1}
                max={bidTarget?.totalMemoryGiB}
                value={bidMemory}
                placeholder={String(bidTarget?.totalMemoryGiB ?? '')}
                onChange={(event) => setBidMemory(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBidTarget(null)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!bidTarget) {
                  return
                }
                try {
                  await createBid.mutateAsync({
                    listingId: bidTarget.id,
                    cpuHourCents: Number(bidCpuPrice) || 0,
                    memoryGiBHourCents: Math.max(1, Math.round((Number(bidCpuPrice) || 0) / 10)),
                    diskGiBHourCents: 1,
                    totalCpu: Number(bidCpu) || bidTarget.totalCpu,
                    totalMemoryGiB: Number(bidMemory) || bidTarget.totalMemoryGiB,
                    totalDiskGiB: bidTarget.totalDiskGiB,
                  })
                  toast.success('出价已提交，等待提供方处理')
                  setBidTarget(null)
                } catch (error) {
                  toast.error(getMarketApiErrorMessage(error))
                }
              }}
              disabled={createBid.isPending}
            >
              {createBid.isPending ? <Spinner /> : '提交出价'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
