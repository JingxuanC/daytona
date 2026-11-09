/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Badge } from '@/components/ui/badge'
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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { useAvailableRegionsQuery } from '@/hooks/queries/useRegionsQuery'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { getMarketApiErrorMessage } from '@/market-api/client'
import {
  useAcceptMarketBidMutation,
  useProviderMarketBidsQuery,
  useProviderMarketListingsQuery,
  usePublishMarketListingMutation,
  useRejectMarketBidMutation,
  useRetireMarketListingMutation,
  useUpdateMarketListingMutation,
} from '@/market-api/queries'
import type { MarketListing } from '@/market-api/types'
import { Plus, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

const COLUMNS = 7

const STATUS_LABELS: Record<MarketListing['status'], string> = {
  draft: '草稿',
  pending_approval: '待审核',
  published: '已上架',
  paused: '已暂停',
  retired: '已下架',
}

function formatPrice(centsPerHour: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${(centsPerHour / 100).toFixed(2)}/h`
}

interface FormState {
  regionId: string
  name: string
  cpuHourCents: string
  memoryGiBHourCents: string
  diskGiBHourCents: string
  totalCpu: string
  totalMemoryGiB: string
  totalDiskGiB: string
  maxCpuPerSandbox: string
  maxMemoryPerSandbox: string
  maxDiskPerSandbox: string
}

const EMPTY_FORM: FormState = {
  regionId: '',
  name: '',
  cpuHourCents: '100',
  memoryGiBHourCents: '10',
  diskGiBHourCents: '1',
  totalCpu: '8',
  totalMemoryGiB: '16',
  totalDiskGiB: '50',
  maxCpuPerSandbox: '4',
  maxMemoryPerSandbox: '8',
  maxDiskPerSandbox: '20',
}

export function MarketPublishTab({ writePermitted }: { writePermitted: boolean }) {
  const { selectedOrganization } = useSelectedOrganization()
  const { data: regions = [] } = useAvailableRegionsQuery(selectedOrganization?.id)
  const { data, isLoading, error, refetch, isFetching } = useProviderMarketListingsQuery()
  const publish = usePublishMarketListingMutation()
  const update = useUpdateMarketListingMutation()
  const retire = useRetireMarketListingMutation()
  const bidsQuery = useProviderMarketBidsQuery()
  const acceptBid = useAcceptMarketBidMutation()
  const rejectBid = useRejectMarketBidMutation()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MarketListing | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const regionOptions = useMemo(
    () => regions.map((region) => ({ id: region.id, name: region.name ?? region.id })),
    [regions],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, regionId: regionOptions[0]?.id ?? '' })
    setDialogOpen(true)
  }

  const openEdit = (listing: MarketListing) => {
    setEditing(listing)
    setForm({
      regionId: listing.regionId,
      name: listing.name,
      cpuHourCents: String(listing.cpuHourCents),
      memoryGiBHourCents: String(listing.memoryGiBHourCents),
      diskGiBHourCents: String(listing.diskGiBHourCents),
      totalCpu: String(listing.totalCpu),
      totalMemoryGiB: String(listing.totalMemoryGiB),
      totalDiskGiB: String(listing.totalDiskGiB),
      maxCpuPerSandbox: String(listing.maxCpuPerSandbox),
      maxMemoryPerSandbox: String(listing.maxMemoryPerSandbox),
      maxDiskPerSandbox: String(listing.maxDiskPerSandbox),
    })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    const payload = {
      regionId: form.regionId,
      name: form.name.trim(),
      cpuHourCents: Number(form.cpuHourCents),
      memoryGiBHourCents: Number(form.memoryGiBHourCents),
      diskGiBHourCents: Number(form.diskGiBHourCents),
      totalCpu: Number(form.totalCpu),
      totalMemoryGiB: Number(form.totalMemoryGiB),
      totalDiskGiB: Number(form.totalDiskGiB),
      maxCpuPerSandbox: Number(form.maxCpuPerSandbox),
      maxMemoryPerSandbox: Number(form.maxMemoryPerSandbox),
      maxDiskPerSandbox: Number(form.maxDiskPerSandbox),
    }
    try {
      if (editing) {
        const { regionId: _regionId, ...rest } = payload
        await update.mutateAsync({ listingId: editing.id, payload: rest })
        toast.success('上架信息已更新（存量租约价格不变）')
      } else {
        await publish.mutateAsync(payload)
        toast.success('已上架，等待需求方租用')
      }
      setDialogOpen(false)
    } catch (err) {
      toast.error(getMarketApiErrorMessage(err))
    }
  }

  const handleToggleStatus = async (listing: MarketListing) => {
    try {
      await update.mutateAsync({
        listingId: listing.id,
        payload: { status: listing.status === 'published' ? 'paused' : 'published' },
      })
      toast.success(listing.status === 'published' ? '已暂停售卖' : '已恢复售卖')
    } catch (err) {
      toast.error(getMarketApiErrorMessage(err))
    }
  }

  const handleRetire = async (listing: MarketListing) => {
    try {
      await retire.mutateAsync(listing.id)
      toast.success('已下架')
    } catch (err) {
      toast.error(getMarketApiErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          把自有节点的空闲容量上架出售。上架会自动开启该 region 的配额校验，并同步节点定价用于结算。
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className="mr-1 size-4" />
            刷新
          </Button>
          <Button size="sm" onClick={openCreate} disabled={!writePermitted || regionOptions.length === 0}>
            <Plus className="mr-1 size-4" />
            上架容量
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
              <TableHead>名称</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>价格</TableHead>
              <TableHead>容量</TableHead>
              <TableHead>租约</TableHead>
              <TableHead>状态</TableHead>
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
              data.items.map((listing) => (
                <TableRow key={listing.id}>
                  <TableCell className="font-medium">{listing.name}</TableCell>
                  <TableCell className="text-sm">{listing.regionName ?? listing.regionId}</TableCell>
                  <TableCell className="text-sm">
                    {formatPrice(listing.cpuHourCents, listing.currency)} ·{' '}
                    {formatPrice(listing.memoryGiBHourCents, listing.currency)} ·{' '}
                    {formatPrice(listing.diskGiBHourCents, listing.currency)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {listing.totalCpu} vCPU · {listing.totalMemoryGiB} GiB · {listing.totalDiskGiB} GiB
                  </TableCell>
                  <TableCell className="text-sm">{listing.activeLeaseCount ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={listing.status === 'published' ? 'success' : 'outline'}>
                      {STATUS_LABELS[listing.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(listing)} disabled={!writePermitted}>
                        编辑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleStatus(listing)}
                        disabled={!writePermitted || listing.status === 'retired'}
                      >
                        {listing.status === 'published' ? '暂停' : '恢复'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetire(listing)}
                        disabled={!writePermitted || listing.status === 'retired'}
                      >
                        下架
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState colSpan={COLUMNS} message="还没有上架的算力，点右上角「上架容量」" />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">收到的出价</h3>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>算力</TableHead>
                <TableHead>出价</TableHead>
                <TableHead>容量</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bidsQuery.data?.items.length ? (
                bidsQuery.data.items.map((bid) => (
                  <TableRow key={bid.id}>
                    <TableCell className="text-sm">{bid.listingName ?? bid.listingId.slice(0, 8)}</TableCell>
                    <TableCell className="text-sm">
                      {formatPrice(bid.cpuHourCents, bid.currency)} ·{' '}
                      {formatPrice(bid.memoryGiBHourCents, bid.currency)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {bid.totalCpu} vCPU · {bid.totalMemoryGiB} GiB
                    </TableCell>
                    <TableCell>
                      <Badge variant={bid.status === 'accepted' ? 'success' : 'outline'}>
                        {bid.status === 'pending'
                          ? '待处理'
                          : bid.status === 'accepted'
                            ? '已接受'
                            : bid.status === 'rejected'
                              ? '已拒绝'
                              : '已撤回'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {bid.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={!writePermitted || acceptBid.isPending}
                            onClick={async () => {
                              try {
                                await acceptBid.mutateAsync(bid.id)
                                toast.success('已接受出价，租约按出价价格创建')
                              } catch (error) {
                                toast.error(getMarketApiErrorMessage(error))
                              }
                            }}
                          >
                            接受
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!writePermitted || rejectBid.isPending}
                            onClick={async () => {
                              try {
                                await rejectBid.mutateAsync(bid.id)
                                toast.success('已拒绝出价')
                              } catch (error) {
                                toast.error(getMarketApiErrorMessage(error))
                              }
                            }}
                          >
                            拒绝
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState colSpan={5} message="还没有收到出价" />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑上架容量' : '上架算力'}</DialogTitle>
            <DialogDescription>
              价格单位为分/小时；容量是单份租约的上限。上架后该 region 会开启配额校验。
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-auto pr-1 sm:grid-cols-2">
            <div className="grid gap-1 sm:col-span-2">
              <Label>Region</Label>
              <Select
                value={form.regionId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, regionId: value }))}
                disabled={Boolean(editing)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择要出售的 region" />
                </SelectTrigger>
                <SelectContent>
                  {regionOptions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="listing-name">名称</Label>
              <Input
                id="listing-name"
                value={form.name}
                placeholder="例如：上海 RTX 4090 池"
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="price-cpu">vCPU 价格（分/小时）</Label>
              <Input
                id="price-cpu"
                type="number"
                min={0}
                value={form.cpuHourCents}
                onChange={(event) => setForm((prev) => ({ ...prev, cpuHourCents: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="price-memory">内存价格（分/GiB·小时）</Label>
              <Input
                id="price-memory"
                type="number"
                min={0}
                value={form.memoryGiBHourCents}
                onChange={(event) => setForm((prev) => ({ ...prev, memoryGiBHourCents: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="price-disk">磁盘价格（分/GiB·小时）</Label>
              <Input
                id="price-disk"
                type="number"
                min={0}
                value={form.diskGiBHourCents}
                onChange={(event) => setForm((prev) => ({ ...prev, diskGiBHourCents: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cap-cpu">可租 vCPU 总量</Label>
              <Input
                id="cap-cpu"
                type="number"
                min={1}
                value={form.totalCpu}
                onChange={(event) => setForm((prev) => ({ ...prev, totalCpu: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cap-memory">可租内存 GiB</Label>
              <Input
                id="cap-memory"
                type="number"
                min={1}
                value={form.totalMemoryGiB}
                onChange={(event) => setForm((prev) => ({ ...prev, totalMemoryGiB: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cap-disk">可租磁盘 GiB</Label>
              <Input
                id="cap-disk"
                type="number"
                min={1}
                value={form.totalDiskGiB}
                onChange={(event) => setForm((prev) => ({ ...prev, totalDiskGiB: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="max-cpu">单沙箱最大 vCPU</Label>
              <Input
                id="max-cpu"
                type="number"
                min={1}
                value={form.maxCpuPerSandbox}
                onChange={(event) => setForm((prev) => ({ ...prev, maxCpuPerSandbox: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="max-memory">单沙箱最大内存 GiB</Label>
              <Input
                id="max-memory"
                type="number"
                min={1}
                value={form.maxMemoryPerSandbox}
                onChange={(event) => setForm((prev) => ({ ...prev, maxMemoryPerSandbox: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="max-disk">单沙箱最大磁盘 GiB</Label>
              <Input
                id="max-disk"
                type="number"
                min={1}
                value={form.maxDiskPerSandbox}
                onChange={(event) => setForm((prev) => ({ ...prev, maxDiskPerSandbox: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={publish.isPending || update.isPending || !form.name.trim()}>
              {publish.isPending || update.isPending ? <Spinner /> : editing ? '保存' : '上架'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
