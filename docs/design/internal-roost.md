# 内部 Roost 控制面（fork 侧 `/internal/roost/v1`）设计与契约

> 状态：M0 + M1 已落地；M3 数据面 HTTP/SSE/二进制 + WebSocket 升级（preview/VNC）均已实现。
> 目标：让 Roost 市场服务（`roost-market-service`）以 mTLS + 短期受限 JWT 调用 Daytona fork 的
> 内部接口，完成租户开通、节点（region/runner）代建、按 source 的配额下发、沙箱代管与整数秒用量读取。
> 对外契约以市场仓 `api/internal-daytona.yaml` 为准，本文记录 fork 侧实现语义与偏差。

## 1. 设计原则

1. **独立监听面**：内部 API 不挂在公网 `0.0.0.0:PORT` 上。它有独立端口与监听地址
   （默认 `127.0.0.1:3101`），公网端口对 `/internal/roost/**` 一律 404。
2. **身份链**：mTLS 客户端证书 = 调用方身份 → 换取短期 JWT（`sub` = 证书 CN）→ 每个请求校验
   `aud/org_id/sandbox_id/scope/exp/jti`。没有全局 service token，也没有 `X-Roost-On-Behalf-Of`。
3. **组织来自凭证**：M1 的 org 一律取 JWT 的 `org_id` 声明；路径里的 `orgId` 必须与声明一致，
   请求体里的 `organizationId` 被忽略（`RoostSandboxesService` 只接受 `orgId` 参数）。
4. **复用现有能力**：region/runner 走 `RegionService`/`RunnerService`，沙箱走 `SandboxService`，
   配额最终物化到现有 `region_quota` 表，不复制任何市场服务或沙箱生命周期代码（AGPL 隔离）。
5. **写操作幂等**：tenant 按 `external_id` 幂等；配额按 `source` 幂等；node region 按
   `node_external_id` 确定性映射（一个 node 一个 region）。

## 2. 监听与 mTLS

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `INTERNAL_ROOST_ENABLED` | `true`（`false` 关闭） | 是否启动内部监听 |
| `INTERNAL_ROOST_PORT` | `3101` | 内部监听端口 |
| `INTERNAL_ROOST_HOST` | `127.0.0.1` | 监听地址；回环/私网地址允许，公网地址或 `0.0.0.0` 启动即失败 |
| `INTERNAL_ROOST_ALLOW_NON_LOOPBACK` | `false` | 显式允许绑定通配/非回环私网地址 |
| `INTERNAL_ROOST_TLS_CERT_PATH` / `_KEY_PATH` | 空 | 服务端证书/私钥；**生产必填** |
| `INTERNAL_ROOST_TLS_CA_PATH` | 空 | 客户端 CA；配置后 `requestCert + rejectUnauthorized` 强制 mTLS |
| `INTERNAL_ROOST_CLIENT_CN_ALLOWLIST` | 空（全部允许） | 逗号分隔的客户端证书 CN 白名单 |

启动规则：

1. **生产环境缺 mTLS（证书 + CA）或 JWT 私钥**：**不启动内部监听器**并打印 ERROR
   （公网 API 不受影响，存量部署可继续启动）；设置 `INTERNAL_ROOST_ENABLED=false` 可关闭提示。
2. **开发/测试无证书**：强制绑定 `127.0.0.1`，以明文 HTTP 启动并打印 WARN，仅回环连接可用；
   `/credentials` 的 mTLS guard 也只接受回环来源（`req.socket.remoteAddress`）。
   本地要联调 mTLS 客户端（市场仓 E2E）时用第 2.1 节脚本签发证书并配置环境变量。
3. 监听地址解析到公网地址 → 启动失败（进程退出，内部接口不得暴露公网）。
4. 监听器与主 API 共享同一个 Nest express 实例（DI/管道/过滤器复用），但：
   - 只分发 `/internal/roost/**`，其他路径直接 404；
   - 主端口上的 `/internal/roost/**` 被 `internalRoostIsolationMiddleware` 拦截为 404；
   - `MaintenanceMiddleware`、`FailedAuthRateLimitMiddleware` 对内部路径排除。
5. 内部监听器随 `app.close()` / 进程信号一起关闭（`OnApplicationShutdown`）。

### 2.1 本地 mTLS 证书（开发/E2E）

```bash
# CA
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj "/CN=roost-internal-ca"
# 服务端（SAN 覆盖 localhost / 127.0.0.1）
openssl req -newkey rsa:2048 -nodes -keyout internal.key -out internal.csr -subj "/CN=daytona.internal"
printf "subjectAltName=DNS:localhost,IP:127.0.0.1" > san.ext
openssl x509 -req -in internal.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out internal.crt -days 30 -extfile san.ext
# 客户端（CN 即 JWT sub / CN 白名单）
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr -subj "/CN=market-api"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 30

export INTERNAL_ROOST_TLS_CERT_PATH=$PWD/internal.crt
export INTERNAL_ROOST_TLS_KEY_PATH=$PWD/internal.key
export INTERNAL_ROOST_TLS_CA_PATH=$PWD/ca.crt
export INTERNAL_ROOST_CLIENT_CN_ALLOWLIST=market-api
# 或先生成密钥对：openssl genpkey -algorithm ed25519 -out jwt.key && openssl pkey -in jwt.key -pubout -out jwt.pub
export INTERNAL_ROOST_JWT_PRIVATE_KEY_PATH=$PWD/jwt.key
export INTERNAL_ROOST_JWT_PUBLIC_KEY_PATH=$PWD/jwt.pub
```

之后市场服务客户端用 `ca.crt` + `client.crt`/`client.key` 访问 `https://127.0.0.1:3101`。

## 3. 短期凭证（M0）

### 3.1 签发 `POST /internal/roost/v1/credentials`

- 鉴权：**仅 mTLS**（内部监听器 + 客户端证书；dev 回环 fallback）。
- 请求体（snake_case，兼容 camelCase 别名）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `aud` | 是 | `daytona-control` 或 `daytona-data` |
| `org_id` | 除 `tenant:provision` 外必填 | 恰好一个组织，不接受通配 |
| `sandbox_id` | `daytona-data` 必填 | 恰好一个沙箱；控制面必须为空 |
| `scope` | 是 | 见下表 |
| `ttl_seconds` | 否 | 控制面默认/上限 900，数据面默认/上限 300 |

scope 取值：`tenant:provision`、`sandbox:control`、`quota:write`、`region:write`、`runner:write`、
`usage:read`、`toolbox`、`preview`。

强约束：

- `tenant:provision` 只能单独出现、必须无 `org_id`/`sandbox_id`，且不能操作其他接口；
- `daytona-data` 凭证必须绑定一个 `sandbox_id`，scope 只能是 `toolbox`/`preview`；
- 控制面凭证不能带 `sandbox_id`，也不能使用数据面 scope。

响应 `201`：`{ token, expires_at, jti, aud }`。

JWT claims：`iss`（默认 `daytona`）、`aud`、`sub`（mTLS 身份，如 `CN=market-api`）、`org_id`、
`sandbox_id`、`scope`、`iat`、`exp`、`jti`。算法 **Ed25519（EdDSA）**。

密钥：`INTERNAL_ROOST_JWT_PRIVATE_KEY_PATH` / `INTERNAL_ROOST_JWT_PUBLIC_KEY_PATH`
（或 `INTERNAL_ROOST_JWT_PRIVATE_KEY` / `_PUBLIC_KEY` 内联 PEM）。生产必须配置；开发未配置时
生成**临时密钥对**并 WARN（重启后旧凭证全部失效，符合短期凭证语义）。

### 3.2 吊销 `POST /internal/roost/v1/credentials/{jti}/revoke`

- 鉴权：仅 mTLS；`204 No Content`。
- 吊销表 `roost_revoked_credentials`，行 TTL = **凭证剩余寿命**：
  - 请求体带 `{ token }` 时校验签名/`jti` 并取 `exp`，`expiresAt = exp`；
  - 只带 `{ exp }` / `{ expires_at }` 时按传入值（上限为当前 + 900s）；
  - 都不带时按当前 + 900s 的保守上限（不会无限增长）。
- 已过期凭证返回 `expired` 且不写行；重复吊销幂等。
- 过期行在后续吊销/校验时机会性清理。

## 4. 数据模型

### 4.1 `roost_tenant_mappings`（migration `1794283200008`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `externalId` | varchar unique | 市场侧 `tenants.id`，幂等键 |
| `organizationId` | uuid FK → organization | |
| `state` | varchar | `ready` / `suspended` |
| `createdAt` / `updatedAt` | timestamptz | |

### 4.2 `roost_revoked_credentials`

`jti` PK；`aud/orgId/sandboxId/scope/reason` 记录吊销上下文；`expiresAt` 为行 TTL；`revokedAt`。

### 4.3 `region_quota_sources`

`(regionId, organizationId, sandboxClass, source)` 唯一。每行是一个来源（`lease:<lease_id>`、
`provider:self` 等）的配额贡献。

**聚合语义**（`aggregateQuotaSources`）：同一 org + region + sandbox_class 上

- 总量 `cpu/memory/disk`：**对各 source 求和**；
- 单沙箱上限 `max_*_per_sandbox`：**取各 source 的最大值**；
- 聚合结果物化写入现有 `region_quota` 行，因此现有沙箱配额校验、region 可见性
  （`listAvailableRegions` 的 CUSTOM + quota 规则）无需改动即生效；
- 删除最后一个 source 时删除物化 `region_quota`，该 region 对该组织重新不可见。

## 5. API 契约（M1）

所有 M1 接口要求 `Authorization: Bearer <control JWT>`，且 `aud=daytona-control`。

| Method | Path | scope | 说明 |
|---|---|---|---|
| POST | `/internal/roost/v1/tenants` | `tenant:provision` | 按 `external_id` 幂等创建 organization；返回 `{ organization_id, state: "ready" }` |
| POST | `/internal/roost/v1/orgs/{orgId}/regions` | `region:write` | 为单个 node 创建 CUSTOM region（`region_id = node_<node_external_id 无横线>`，重复调用幂等） |
| POST | `/internal/roost/v1/regions/{regionId}/runners` | `runner:write` | 创建 v2 runner；`api_key` **只在此响应出现一次** |
| GET | `/internal/roost/v1/runners/{runnerId}` | `runner:write` | 节点心跳视图，见 5.1 |
| DELETE | `/internal/roost/v1/runners/{runnerId}` | `runner:write` | 节点下线：先把 runner 标为 unschedulable，再走 `RunnerService.remove` 的既有前置校验（仍有沙箱时返回 `400 invalid_request`，可重试） |
| PUT | `/internal/roost/v1/orgs/{orgId}/regions/{regionId}/quota` | `quota:write` | 按 `(source, sandbox_class)` 幂等写入并物化聚合 |
| DELETE | `/internal/roost/v1/orgs/{orgId}/regions/{regionId}/quota?source=&sandbox_class=` | `quota:write` | 删除单个 source（重复删除幂等） |
| POST | `/internal/roost/v1/orgs/{orgId}/sandbox` | `sandbox:control` | 代建沙箱（org 来自 JWT） |
| GET | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}` | `sandbox:control` | |
| DELETE | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}` | `sandbox:control` | 204 |
| POST | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}/start` | `sandbox:control` | |
| POST | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}/stop` | `sandbox:control` | |
| POST | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}/pause` | `sandbox:control` | 可选 M1 操作，见 5.5 |
| POST | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}/resize` | `sandbox:control` | 可选 M1 操作，见 5.5 |
| POST | `/internal/roost/v1/orgs/{orgId}/sandbox/{sandboxId}/snapshot` | `sandbox:control` | 可选 M1 操作，见 5.5 |
| GET | `/internal/roost/v1/orgs/{orgId}/usage?from=&to=&group_by=sandbox` | `usage:read` | 整数秒用量，来自 `sandbox_usage_periods` |

- 路径 `orgId` 与 JWT `org_id` 不一致 → `403 forbidden`（`RoostOrgBindingGuard`）。
- 资源不属于该组织 → `404 not_found`（不泄露存在性）。
- 错误统一为契约 envelope：`{"error":{"code","message","request_id","details"?}}`，
  code ∈ `unauthorized/forbidden/not_found/conflict/invalid_request/upstream_unavailable`。
- `X-Request-Id` / `Idempotency-Key` 目前只用于错误响应回填 `request_id`，**不强制**（网关接入后再收紧），
  幂等语义由 `external_id` / `source` / node 映射保证。

### 5.1 节点心跳 `GET /internal/roost/v1/runners/{runnerId}`

供 market worker 轮询判定节点在线/离线（对齐市场仓 `api/internal-daytona.yaml` 的
`getRunner` 形状，snake_case）：

```json
{
  "runner_id": "runner-uuid",
  "state": "ready",
  "last_seen_at": "2026-11-10T12:00:00.000Z",
  "sandbox_count": 2
}
```

- `state`：Daytona `RunnerState` 字符串（`initializing/ready/disabled/decommissioned/unresponsive`）。
- `last_seen_at`：`runner.lastChecked`，从未上报为 `null`。
- `sandbox_count`：该 runner 上未归档/未销毁沙箱数；统计失败时为 `null`（不影响心跳轮询）。
- 只有 runner 所属 region 的 owner 组织可读；跨组织/不存在一律 `404`。
- scope 选用 `runner:write`（契约 scope 枚举没有 `runner:read`，不新增枚举值以保持契约兼容）。

### 5.2 沙箱状态映射

契约状态集固定为 `creating/starting/started/stopping/stopped/pausing/paused/deleting/deleted/error`，
Daytona 更细的状态按下表折叠：`pending_build/building_snapshot → creating`；
`restoring/resuming/pulling_snapshot → starting`；`resizing/snapshotting/forking → started`；
`archiving → stopping`；`archived → stopped`；`unknown → error`。

### 5.3 沙箱代建注意点

- 请求体 `cpu/memory_gib/disk_gib` 为契约兼容字段：Daytona v1 沙箱资源由 snapshot 决定，
  **不以请求体为准**，租约容量通过物化 `region_quota` 限制。
- 新增可选 fork 扩展字段 `region_id`（兼容 `regionId` / `target`），把沙箱钉到 provider 节点
  region；契约原文未包含该字段（市场侧需要把租约沙箱调度到提供方 region），已在 PR 说明。
- 请求体中的 `organizationId` 一律忽略；组织只取自 JWT。

### 5.4 用量口径

`from`/`to` 为 ISO-8601（兼容 unix 秒），返回的均为**整数秒**（对窗口重叠时长 × 分配量取整）：

- `cpu_seconds = cpu × seconds`
- `memory_mib_seconds = memoryGiB × 1024 × seconds`
- `disk_mib_seconds = diskGiB × 1024 × seconds`
- `gpu_seconds = gpu × seconds`

本接口不返回金额，金额由市场服务用租约价格快照计算。

### 5.5 M1 可选沙箱操作（pause / resize / snapshot）

三个端点都要求 `aud=daytona-control` + scope `sandbox:control`，组织只取自 JWT `org_id`，
路径 org 与声明不一致 `403`，sandbox 不属于该组织 `404`。请求体中出现未支持字段（含
`organizationId`）一律 `400 invalid_request`，错误 message 写明 `Unsupported field(s) ... Supported fields ...`。

| 端点 | body（fork 实际支持） | 成功响应 | 状态码 |
|---|---|---|---|
| `POST .../sandbox/{sandboxId}/pause` | 无（传任何字段都 400） | `{ id, state, organization_id }` | `200` |
| `POST .../sandbox/{sandboxId}/resize` | `{ cpu?, memory?, disk? }`，number >= 1，至少一个 | `{ id, state, organization_id }` | `200` |
| `POST .../sandbox/{sandboxId}/snapshot` | `{ name, includeMemory? }`（`name` 必填；`include_memory` 别名） | `{ id, state, organization_id, snapshot_name }` | `200` |

实现全部委托现有 `SandboxService`，不复制生命周期代码：

- **pause**：`SandboxService.pause`。仅 `STARTED` 的 VM/Windows 沙箱可 pause；容器沙箱返回
  `422`（Daytona 既有语义），其它状态 `400`。
- **resize**：`SandboxService.resize`（`ResizeSandboxDto` 只支持 `cpu/memory/disk`）。
  `memory_gib`/`disk_gib`/`gpu` 等字段**不支持**，会 400。fork 既有语义继续生效：`STARTED`
  只能增加 cpu/memory 不能减少；`disk` 只能增加且要求 `STOPPED`；超出组织/region 配额 400。
  **注意**：公开 API 的 resize 有 `SANDBOX_RESIZE` feature flag 门控，内部端点直接调用服务层
  （服务本身无该 gate），因此不受 flag 影响 —— 如需要一致门控可在后续接 `FeatureFlagsService`。
- **snapshot**：`SandboxService.createSnapshotFromSandbox`（`CreateSandboxSnapshotDto`）。
  **fork 不支持自命名/空名**：`name` 必填（<=255，安全显示字符串），market 侧需自行生成
  （如 `sbx-<sandboxId>-<epoch>`）。`includeMemory` 仅 Windows 沙箱支持，其余返回 400。
  该调用是**异步**的：同步返回的是沙箱控制视图，快照实体由 snapshot manager 异步创建，
  M1 不提供“按 name 查快照 id/状态”的内部端点，因此响应只有 `snapshot_name`（没有
  `snapshot_id`）。后续用该 `name` 作为 create 沙箱的 `snapshot` 字段即可（create 接受 id 或 name）。

## 6. M3 数据面（best effort）

提供 `RoostDataPlaneGuard`（`InternalRoostModule` 导出）供 toolbox/preview 转发接入：

- `aud` 必须为 `daytona-data`；
- 凭证必须绑定唯一 `sandbox_id`，且必须等于路径 `:sandboxId`；
- 必须未吊销；
- 声明 scope（`toolbox` / `preview`）必须齐备。

接入示例（M3 转发实现时直接挂 guard，无需改本文档）：

```ts
@Controller(INTERNAL_ROOST_PATH)
@Public()
@UseGuards(RoostMtlsGuard, RoostDataPlaneGuard)
@UseFilters(RoostExceptionsFilter)
export class InternalDataPlaneController {
  @Get('sandboxes/:sandboxId/toolbox/{*path}')
  @RoostScopes(RoostScope.TOOLBOX)
  toolbox(@Param('sandboxId') sandboxId: string) {
    // 校验通过后转发到该沙箱的 toolbox；sandboxId 来自凭证，无法越权
  }
}
```

注意：`/credentials` 之外的数据面/控制面请求仍然先过 mTLS（`RoostMtlsGuard` / 监听器 TLS 层）。

## 7. 验收

```bash
source .toolchain/env.sh 2>/dev/null || true
NODE=/Users/paopao/Library/pnpm/bin/node
$NODE node_modules/typescript/bin/tsc -p apps/api/tsconfig.app.json --noEmit
$NODE node_modules/nx/bin/nx.js run api:build
$NODE node_modules/jest/bin/jest.js --config apps/api/jest.config.ts --passWithNoTests "apps/api/src/internal-roost"
```

单测覆盖：JWT 签名/过期/篡改、scope 跨 scope 拒绝、audience 隔离、组织路径绑定、mTLS fallback、
tenant 幂等（含并发 23505 竞态）、配额 source 聚合/物化/删除回收、沙箱 org 绑定（忽略 body
organizationId）、吊销 TTL/幂等/过期、runner 心跳 200/404/跨组织 404、暂停/resize/snapshot
（org 绑定、跨组织 404、未支持字段 400、snapshot 名称校验、scope 元数据与 403）、独立监听器与公网隔离 wiring。

本地手工验证（无 DB 的 dev 环境可用 `curl` 验证监听行为；有 DB/Redis 时可完整联调）：

```bash
curl -sk https://127.0.0.1:3101/internal/roost/v1/ping        # 仅 internal-roost 下不存在 → 404 envelope
curl -s http://127.0.0.1:3100/internal/roost/v1/credentials     # 公网端口 → 404（隔离中间件）
```

## 8. 已知限制 / 后续

- M3 只提供 guard 与接入说明，toolbox/preview 的字节流转发尚未实现。
- `cpu/memory_gib/disk_gib` 不会被应用到沙箱（Daytona v1 以 snapshot 为准）；如需硬性资源隔离，
  后续在沙箱创建路径支持显式资源。
- 吊销表靠机会性清理过期行，无独立 cron；数据量受短期凭证 TTL 约束。
- `X-Request-Id` / `Idempotency-Key` 暂不强制，幂等仅由业务键保证。
- 签发请求体兼容 camelCase 只是 fork 内部便利，市场仓应按契约使用 snake_case。
- node → region 映射为确定性 id（一个 node 一个 CUSTOM region），未新增映射表；如需改名/重建，
  需按新 node external id 生成新 region。
- `DELETE /runners/{runnerId}` 只自动置 unschedulable，不主动置 draining；节点上有沙箱时返回 400，
  市场侧后台可重试，沙箱结束/迁移后再删除成功。
- 可选沙箱操作：snapshot 为异步操作，M1 无法同步返回 `snapshot_id`/快照状态（只有 `snapshot_name`）；
  resize 收到的是 fork 字段名（`cpu/memory/disk`，非 `*_gib`）；内部 resize 不检查公开 API 的
  `SANDBOX_RESIZE` feature flag。

## 5.5 数据面实现（M3，2026-11-10）

内部监听器同时承载数据面路由（docs/03-api-contract.md §B6），供市场服务的边缘代理
（或后续 Envoy 直连）转发 toolbox / preview 流量：

```
ANY /internal/roost/v1/sandboxes/{sandboxId}/toolbox/*
ANY /internal/roost/v1/sandboxes/{sandboxId}/preview/*
```

- 鉴权：`RoostMtlsGuard` + `RoostDataPlaneGuard`；要求 `aud=daytona-data`、
  `sandbox_id == {sandboxId}`、scope 分别为 `toolbox` / `preview`、jti 未吊销。
- 上游：`sandbox.runnerId → runner.proxyUrl`，请求头注入
  `X-Daytona-Authorization: Bearer {runner.apiKey}`（客户端 `Authorization` 一律剥离）。
  - toolbox：`{runner.proxyUrl}/sandboxes/{id}/toolbox{rest}`
  - preview：`{runner.proxyUrl}/sandboxes/{id}/toolbox/proxy/{port}{rest}`
    - 端口来源：`?port=` 优先；否则取路径首段数字（`/preview/3000/app` → 3000）。
    - 两者都没有 → `400 invalid_request`（端口从 query 消费后不再转发上游）。
- 流式：请求/响应均用 `node:http(s)` 直接 pipe，SSE / chunked / 二进制不缓冲；
  响应头先 `flushHeaders`。
- 错误：沙箱不存在/不属于该 org → `404`；非 started → `409`；runner 不可用/无 proxyUrl →
  `502 upstream_unavailable`；上游连接失败 → `502`（错误 envelope 与内部控制面一致）。
### WebSocket 升级（M3.1，已实现）

preview/VNC 等场景走同一内部监听器的 Node `upgrade` 事件（`InternalRoostUpgradeService`），
不经过 express 管道，因此鉴权在握手前独立完成：

```
GET /internal/roost/v1/sandboxes/{sandboxId}/preview/{rest}     Upgrade: websocket
GET /internal/roost/v1/sandboxes/{sandboxId}/toolbox/{rest}     Upgrade: websocket
```

- **只接受** 上述两类数据面路径的 WebSocket 升级：其余 `/internal/roost/**` upgrade 直接
  `socket.destroy()`；非 WebSocket 握手（缺 `Sec-WebSocket-Key` 等）返回 `400 invalid_request`。
- **鉴权**（握手前，失败先写 HTTP 错误 envelope 再关闭 socket）：
  - mTLS 已在 TLS 层完成（`requestCert + rejectUnauthorized`）；dev 无 CA fallback 仅接受回环；
  - `Authorization: Bearer <aud=daytona-data JWT>` → `verifyDataToken` + `assertNotRevoked`；
  - `aud` 必须为 `daytona-data`；`sandbox_id` 必须等于路径 `{sandboxId}`；
    preview 路径要求 scope `preview`，toolbox 路径要求 scope `toolbox`；`org_id` 必须存在；
  - 状态码：缺凭证/验签失败/已吊销 `401 unauthorized`；audience、sandbox 绑定、scope、
    transport 不允许 `403 forbidden`。
- **上游**（复用 `RoostDataPlaneService` 的 sandbox→runner 解析与端口约定）：
  - preview：`ws(s)://{runner.proxyUrl}/sandboxes/{id}/toolbox/proxy/{port}{rest}`
  - toolbox：`ws(s)://{runner.proxyUrl}/sandboxes/{id}/toolbox{rest}`
  - 端口：`?port=` 优先，其次路径首段数字（`/preview/3000/ws` → 3000），都没有 → `400`；
    被消费的 `port` query 不再转给上游。
- **请求头**：只透传 `Sec-WebSocket-Key/Version/Protocol/Extensions`、`Origin`、`User-Agent`
  （另加 `X-Forwarded-Host`），注入 `X-Daytona-Authorization: Bearer {runner.apiKey}`；
  **客户端 `Authorization` 与 `Cookie` 一律不透传**。
- **转发**：上游 `upgrade` 后把 `101 Switching Protocols` 响应头写回客户端 socket，处理双方
  `head` 缓冲，随后双向 `pipe`；error/close 双向清理。**不设置 idle 超时**，长连接 WebSocket
  不会被默认截断（socket 级的 HTTP server timeout 在 Node 中只作用于非升级连接）。
- **错误语义**：sandbox 不存在/不属于该 org `404`；非 started `409`；runner 不可用/无 proxyUrl/
  连接失败 `502 upstream_unavailable`；上游以非 101 HTTP 响应拒绝握手时，该响应（状态码/头/体）
  原样转发给客户端。

集成测试（`internal-roost.ws.spec.ts`）用 `ws` 包起的 fake runner WebSocket echo server +
真实内部监听器验证：preview/toolbox echo、`?port=` 约定、跨 sandbox 403、缺凭证 401、
上游 403 透传、runner 不可达 502、非数据面 upgrade 被销毁，以及自签证书下的真实
`wss://` 升级 echo。
