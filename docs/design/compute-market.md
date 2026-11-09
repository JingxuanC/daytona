# 算力市场（M1）设计与契约

> 状态：冻结（M1）。实现范围以本文为准，M2/M3 仅记录方向。
> 目标：让一个组织（provider）把自有节点容量**上架出售**，另一个组织（consumer）**发现并租用**，
> 在自己没有节点的情况下把沙箱调度到 provider 的节点上，并让提供方经营视图（用量/收益）与消费方用量都正确。

## 1. 设计原则

1. **不设全局身份区分**：任何组织都可以既消费又提供（capability-based）。「注册节点」（BYOC）与「上架出售」是两个动作。
2. **复用现有授权/配额机制**：市场 region 通过 `region_quota` 授权给 consumer，sandbox 调度、配额校验复用现有路径，不新写调度器。
3. **不新增 RegionType**（M1）：provider 的 `CUSTOM` region 在发布 listing 后即成为「可被租用的市场 region」。访问权来自 `region_quota`（与 `DEDICATED` region 的既有语义一致）。
4. **收益归属不变**：region 仍归 provider 组织，现有 provider 结算/告警/指标链路继续按 region 归属 owner。
5. **M1 不扣钱**：只记录价格与应付金额；真正扣费/抽成/账本放 M2。

## 2. 角色与页面可见性

| 能力/页面 | 规则 |
|---|---|
| 注册节点（Region/Runner） | 组织 owner/admin（现有 `organization_infrastructure` flag + READ_RUNNERS/WRITE_REGIONS 权限） |
| 发布/下架/调价 | 组织 owner/admin（`WRITE_RUNNERS`），且 region 属于本组织 |
| 算力市场（浏览） | 所有组织成员（不加额外权限） |
| 开通租约 | 有 `WRITE_SANDBOXES` 权限 |
| 我的租用/我的用量 | 所有组织成员（本组织范围） |
| 算力控制台（提供方） | 组织有节点时显示（保持现状，无节点时不显示） |
| Regions/Runners 页面 | 保持现状（org admin + flag） |

## 3. 数据模型（M1）

### 3.1 `market_listings`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `providerOrganizationId` | varchar | 供给方（region owner） |
| `regionId` | varchar | 被售卖的 region（必须是 provider 的 CUSTOM region） |
| `name` | varchar | 展示名 |
| `description` | text null | |
| `currency` | varchar(3) | 默认 `CNY` |
| `cpuHourCents` | int | 每 vCPU·时（分） |
| `memoryGiBHourCents` | int | 每 GiB·时（分） |
| `diskGiBHourCents` | int | 每 GiB·时（分） |
| `gpuHourCents` | int default 0 | |
| `totalCpu` / `totalMemoryGiB` / `totalDiskGiB` | int | 可租容量上限（单租约） |
| `maxCpuPerSandbox` / `maxMemoryPerSandbox` / `maxDiskPerSandbox` | int | 单沙箱上限 |
| `maxSandboxes` | int default 10 | |
| `visibility` | enum `public` | M1 只支持 public |
| `status` | enum `draft`/`published`/`paused`/`pending_approval`/`retired` | |
| `platformFeeBps` | int default 0 | M2 预留 |
| `createdAt` / `updatedAt` | timestamptz | |

约束：`unique(providerOrganizationId, regionId)`。

### 3.2 `market_leases`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `listingId` | uuid FK → market_listings | |
| `consumerOrganizationId` | varchar | 需求方 |
| `status` | enum `active`/`closed` | |
| `priceSnapshot*Cents` | int | 开租时价格快照（cpu/mem/disk/gpu/currency） |
| `totalCpu` / `totalMemoryGiB` / `totalDiskGiB` | int | 本租约配额 |
| `maxCpuPerSandbox` / `maxMemoryPerSandbox` / `maxDiskPerSandbox` | int | |
| `createdAt` / `closedAt` | timestamptz | |

约束：`unique(consumerOrganizationId, listingId) WHERE status = 'active'`。

### 3.3 与 `region_quota` 的关系

- 发布 listing：region 置 `enforceQuotas = true`（内部方法，非公开 API），并创建/更新 **provider 自用 quota** = listing 容量（保证 provider 自己仍能跑沙箱）。
- 开租约：创建/更新 consumer 在该 region 的 `region_quota`（cpu/mem/disk 总量 + 单沙箱上限 + snapshot/volume 配额沿用默认）。
- 关闭租约：删除该 consumer 的 `region_quota`（如果无其他 active 租约指向同一 region）；已有沙箱不受影响（存量沙箱继续按 region 配额？M1 记录为已知限制：关租约后新沙箱无法创建，存量允许自然结束）。

## 4. API 契约（冻结）

所有接口沿用现有鉴权：`Authorization: Bearer <org API key>`（`OrganizationAuthContext`）。

### 4.1 消费方（任意组织成员）

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/market/listings` | 登录即可 | 浏览 `published` listings（全平台可见） |
| POST | `/api/market/leases` | `WRITE_SANDBOXES` | body：`{ listingId, totalCpu?, totalMemoryGiB?, totalDiskGiB? }`；幂等：已有 active 租约则返回/更新 |
| GET | `/api/market/leases` | 登录即可 | 本组织租约（含 listing/region/价格快照） |
| POST | `/api/market/leases/:id/close` | `WRITE_SANDBOXES` | 关闭租约并回收 quota |
| GET | `/api/market/usage?from=&to=` | 登录即可 | 本组织在市场 region 的用量 + 按价格快照计算的应付金额（分） |

错误语义（沿用现有过滤器）：
- `404 listing not found`（不存在/已下架）
- `403` 权限不足（quota/权限）
- `409` 容量不足 / 重复租约冲突
- `400` 参数非法

### 4.2 供方（provider，`WRITE_RUNNERS`/`READ_RUNNERS`）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/provider/market/listings` | 本组织 listing 列表（含租约数/使用摘要） |
| POST | `/api/provider/market/listings` | 发布（body 见 3.1；未提供 `regionId` 时用 `regionId` 必填校验） |
| PATCH | `/api/provider/market/listings/:id` | 改价/改容量/`status=published|paused` |
| DELETE | `/api/provider/market/listings/:id` | 下架（status=retired） |
| GET | `/api/provider/market/leases` | 本组织 listing 上的租约（用途：容量利用率） |

### 4.3 区域可见性扩展（关键复用点）

`OrganizationService.listAvailableRegions` 增加一条规则：

> `CUSTOM` region 若存在该组织的 `region_quota` → 对该组织可见。

这样 consumer 开租后，现有 `/api/organizations/:id/available-regions` 自动包含市场 region，现有 `CreateSandboxSheet` 的 region 选择器与 `target` 参数无需改动即可使用。

### 4.4 授权修复（P0，独立小 PR）

`sandbox.service.getValidatedOrDefaultRegion` 目前对显式 `target` 只按 name/id 查 region，不校验可用性。改为与 snapshot 服务一致：

- 不在 `listAvailableRegions` 且非 `SHARED` → `404 Region not found`
- `SHARED` 但无 quota → `403`

## 5. 归因与结算（复用 P1–P4）

1. 用量归属：`sandbox_usage_periods.organizationId` = consumer（不变）；`.runnerId` = provider 节点（不变）。
2. Provider 用量/收益：provider 侧接口改为按 **provider 名下 runner** 聚合（不再只按 `organizationId = provider`），从而包含 consumer 的用量；`runner_pricing` 继续作为结算单价（发布 listing 时同步写入）。
3. Consumer 应付金额：按 lease 价格快照 × 用量（**不以 provider 后续调价影响已开租约**）。
4. M1 结算单沿用现有 `settlement_periods`（provider 收益）；consumer 侧只展示应付金额，M2 再做扣费/发票。

## 6. 验收（两组织 E2E）

脚本 `scripts/accept-compute-market.sh`（本地 docker 栈，使用 admin key + DB mint 的 consumer key）：

1. provider 建 region + 注册 runner（跑真实 runner 容器）→ ready
2. provider 发布 listing（价格 100/10/1 分，容量 8c/16GiB/50GiB）
3. consumer 浏览 → 开通租约（4c/8GiB/20GiB）→ `available-regions` 出现市场 region
4. consumer 在该 region 建快照（ubuntu:24.04）+ 沙箱（`target=regionId`）→ started
5. provider `/provider/usage` 出现 consumer 用量（按 runner 归因）；`recompute` → 结算金额正确
6. consumer `/market/usage` 金额 = 用量 × lease 价格快照
7. 关闭租约 → consumer `region_quota` 消失，新沙箱创建被拒
8. 清理

## 7. 明确不做（M2/M3）

- 消费方账本/预充值/扣费/发票、平台抽成（M2；`platformFeeBps` 已预留）
- 竞价/价格排序/抢占/SLA/评价（M3）
- 平台审批流（`MARKET_REQUIRE_PROVIDER_APPROVAL` 默认 false；true 时 listing 进 `pending_approval`，M1 仅预留状态，不做审批 UI）
- 专用 `MARKET` region 类型（M2 视需要再引入；M1 用 CUSTOM+quota 已满足语义）
