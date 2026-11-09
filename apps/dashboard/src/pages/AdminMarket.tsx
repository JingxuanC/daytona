/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { PageContent, PageHeader, PageIntro, PageLayout } from '@/components/PageLayout'
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
import { useApi } from '@/hooks/useApi'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { getMarketApiErrorMessage } from '@/market-api/client'
import {
  useAdminMarketTopupMutation,
  useMarketOverviewQuery,
  useMarketSettingsQuery,
  useRunMarketRiskMutation,
  useUpdateMarketSettingsMutation,
} from '@/market-api/queries'
import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'

const formatCents = (cents: number) => `¥${(cents / 100).toFixed(2)}`

const AdminMarket: React.FC = () => {
  const settingsQuery = useMarketSettingsQuery()
  const overviewQuery = useMarketOverviewQuery(!settingsQuery.isError)
  const updateSettings = useUpdateMarketSettingsMutation()
  const topup = useAdminMarketTopupMutation()
  const runRisk = useRunMarketRiskMutation()

  const [feeBps, setFeeBps] = useState('')
  const [topupOrg, setTopupOrg] = useState('')
  const [topupAmount, setTopupAmount] = useState('10000')
  const [topupNote, setTopupNote] = useState('平台充值')

  useEffect(() => {
    if (settingsQuery.data) {
      setFeeBps(String(settingsQuery.data.platformFeeBps))
    }
  }, [settingsQuery.data])

  if (settingsQuery.isError) {
    return (
      <PageLayout>
        <PageHeader />
        <PageContent>
          <PageIntro title="算力市场运营后台" desc="仅系统管理员可访问。" />
          <Card>
            <CardHeader>
              <CardTitle>需要系统管理员权限</CardTitle>
              <CardDescription>{getMarketApiErrorMessage(settingsQuery.error)}</CardDescription>
            </CardHeader>
          </Card>
        </PageContent>
      </PageLayout>
    )
  }

  const overview = overviewQuery.data
  const negativeOrganizations = overview?.negativeBalanceOrganizations ?? []

  const handleSaveSettings = async () => {
    try {
      await updateSettings.mutateAsync(Number(feeBps))
      toast.success('平台抽成率已更新')
    } catch (error) {
      toast.error(getMarketApiErrorMessage(error))
    }
  }

  const handleTopup = async (organizationId = topupOrg) => {
    try {
      await topup.mutateAsync({
        organizationId,
        amountCents: Number(topupAmount),
        description: topupNote || undefined,
      })
      toast.success(`已为 ${organizationId.slice(0, 8)} 充值 ${formatCents(Number(topupAmount))}`)
      if (organizationId === topupOrg) {
        setTopupOrg('')
      }
    } catch (error) {
      toast.error(getMarketApiErrorMessage(error))
    }
  }

  const handleRiskRun = async () => {
    try {
      await runRisk.mutateAsync()
      toast.success('风控已执行：负余额组织会被停沙箱并关闭租约')
    } catch (error) {
      toast.error(getMarketApiErrorMessage(error))
    }
  }

  return (
    <PageLayout>
      <PageHeader />
      <PageContent size="full">
        <PageIntro title="算力市场运营后台" desc="平台侧：抽成率配置、手动充值、负余额处置与风险控制。" />

        <div className="grid gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>平台抽成</CardDescription>
              <CardTitle className="text-2xl">
                {settingsQuery.data ? `${(settingsQuery.data.platformFeeBps / 100).toFixed(2)}%` : '—'}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>活跃租约</CardDescription>
              <CardTitle className="text-2xl">{overview?.activeLeases ?? '—'}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>累计扣费 / 抽成</CardDescription>
              <CardTitle className="text-2xl">
                {overview
                  ? `${formatCents(overview.charges.amountCents)} / ${formatCents(overview.charges.platformFeeCents)}`
                  : '—'}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>负余额组织</CardDescription>
              <CardTitle className="text-2xl">{negativeOrganizations.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>平台抽成率</CardTitle>
              <CardDescription>写入运行时设置，立即生效（单位：基点，1000 = 10%）。</CardDescription>
            </CardHeader>
            <CardContent className="flex items-end gap-3">
              <div className="grid flex-1 gap-1">
                <Label htmlFor="fee-bps">抽成基点（0-10000）</Label>
                <Input
                  id="fee-bps"
                  type="number"
                  min={0}
                  max={10000}
                  value={feeBps}
                  onChange={(event) => setFeeBps(event.target.value)}
                />
              </div>
              <Button onClick={handleSaveSettings} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? <Spinner /> : '保存'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>手动充值</CardTitle>
              <CardDescription>自托管 M2 没有支付通道，由平台管理员为组织充值。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-1">
                <Label htmlFor="topup-org">组织 ID</Label>
                <Input
                  id="topup-org"
                  value={topupOrg}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  onChange={(event) => setTopupOrg(event.target.value)}
                />
              </div>
              <div className="flex items-end gap-3">
                <div className="grid w-32 gap-1">
                  <Label htmlFor="topup-amount">金额（分）</Label>
                  <Input
                    id="topup-amount"
                    type="number"
                    min={1}
                    value={topupAmount}
                    onChange={(event) => setTopupAmount(event.target.value)}
                  />
                </div>
                <div className="grid flex-1 gap-1">
                  <Label htmlFor="topup-note">备注</Label>
                  <Input id="topup-note" value={topupNote} onChange={(event) => setTopupNote(event.target.value)} />
                </div>
                <Button
                  onClick={() => handleTopup()}
                  disabled={topup.isPending || !topupOrg.trim() || Number(topupAmount) <= 0}
                >
                  {topup.isPending ? <Spinner /> : '充值'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">负余额处置</h3>
            <Button variant="outline" size="sm" onClick={handleRiskRun} disabled={runRisk.isPending}>
              {runRisk.isPending ? <Spinner /> : '立即执行风控'}
            </Button>
          </div>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>组织</TableHead>
                  <TableHead className="text-right">余额</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overviewQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center">
                      <Spinner className="mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : negativeOrganizations.length ? (
                  negativeOrganizations.map((item) => (
                    <TableRow key={item.organizationId}>
                      <TableCell className="font-mono text-xs">{item.organizationId}</TableCell>
                      <TableCell className="text-right text-sm text-destructive">
                        {formatCents(item.balanceCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => handleTopup(item.organizationId)}>
                          充值 {formatCents(Number(topupAmount) || 0)}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmptyState colSpan={3} message="没有负余额组织" />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      </PageContent>
    </PageLayout>
  )
}

export default AdminMarket
