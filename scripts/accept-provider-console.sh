#!/usr/bin/env bash
#
# 算力控制台（issue #1）本地 E2E 验收脚本
#
# 在「有 Docker、本地 Daytona 栈已启动」的机器上运行：
#
#   cd /path/to/daytona
#   ORG_KEY=<组织 API Key> ./accept-provider-console.sh
#
# 组织 API Key 获取方式：登录 Dashboard → API Keys → Create Key（勾选全部权限，
# 至少需要 write:regions / read:runners / write:runners）。
#
# 可选环境变量：
#   API         API 地址，默认 http://127.0.0.1:3100/api
#   ADMIN_KEY   平台 admin key，默认 localdev-admin-key（docker-compose.local.yaml）
#   ORG_KEY     必填，组织 API Key
#   DAY         要结算的 UTC 日，默认昨天（YYYY-MM-DD）
#   SVC         数据库 compose 服务名，默认 db
#   WAIT_ALERTS 设为 1 时等待 ~75s 验证节点离线告警（默认 0）
#   CLEANUP     设为 1 时删除本次创建的 runner 和 region（默认 0）
#
# 覆盖范围：
#   P1 建自定义 region + runner → GET /provider/nodes、/provider/nodes/:id/sandboxes
#   P2 注入用量 → GET /provider/usage（按节点×天）
#   P3 定价 → 重算结算 → /provider/settlements、/provider/earnings → admin 标记已结算
#   P4 节点离线告警（可选等待）→ /provider/alerts + resolve
#
set -euo pipefail

API="${API:-http://127.0.0.1:3100/api}"
ADMIN_KEY="${ADMIN_KEY:-localdev-admin-key}"
ORG_KEY="${ORG_KEY:-}"
SVC="${SVC:-db}"
WAIT_ALERTS="${WAIT_ALERTS:-0}"
CLEANUP="${CLEANUP:-0}"

COMPOSE=(docker compose -f docker/docker-compose.yaml -f docker/docker-compose.local.yaml)
SUFFIX="$(date +%s)"
REGION_NAME="acc-region-${SUFFIX}"
RUNNER_NAME="acc-node-${SUFFIX}"

info() { printf '→ %s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ---- date helpers (BSD + GNU) -------------------------------------------------
yesterday_utc() {
  if date -u -v-1d +%Y-%m-%d >/dev/null 2>&1; then
    date -u -v-1d +%Y-%m-%d
  else
    date -u -d 'yesterday' +%Y-%m-%d
  fi
}
DAY="${DAY:-$(yesterday_utc)}"

# ---- json helper --------------------------------------------------------------
json_get() {
  # json_get '<json>' 'a.b.0.c'
  python3 - "$1" "$2" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
path = sys.argv[2]
cur = data
for part in [p for p in path.split('.') if p != '']:
    cur = cur[int(part)] if isinstance(cur, list) else cur[part]
print(cur)
PY
}

api() {
  # api METHOD PATH [BODY] [KEY]  -> prints response body
  local method="$1" path="$2" body="${3:-}" key="${4:-$ORG_KEY}"
  local args=(-sS -X "$method" "$API$path" -H "Authorization: Bearer $key")
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  curl "${args[@]}"
}

require_tools() {
  command -v curl >/dev/null || fail "需要 curl"
  command -v python3 >/dev/null || fail "需要 python3"
  command -v docker >/dev/null || fail "需要 docker（本地栈运行在 Docker 里）"
}

main() {
  [[ -n "$ORG_KEY" ]] || fail "请先设置 ORG_KEY=<组织 API Key>（Dashboard → API Keys）"

  require_tools

  info "0. API 健康检查 $API/config"
  curl -sf "$API/config" >/dev/null || fail "API 不可达，先启动本地栈：${COMPOSE[*]} up -d"
  ok "API 已就绪"

  # ---------------------------------------------------------------- P1 region
  info "1. 创建自定义 region：$REGION_NAME"
  REGION_RESP=$(api POST /regions "{\"name\":\"$REGION_NAME\",\"enforceQuotas\":false}" "$ORG_KEY")
  REGION_ID=$(json_get "$REGION_RESP" id)
  [[ -n "$REGION_ID" ]] || fail "创建 region 失败：$REGION_RESP"
  ok "regionId=$REGION_ID"

  info "2. 在 region 上创建 runner：$RUNNER_NAME"
  RUNNER_RESP=$(api POST /runners "{\"name\":\"$RUNNER_NAME\",\"regionId\":\"$REGION_ID\"}" "$ORG_KEY")
  RUNNER_ID=$(json_get "$RUNNER_RESP" id)
  RUNNER_TOKEN=$(json_get "$RUNNER_RESP" apiKey)
  [[ -n "$RUNNER_ID" && -n "$RUNNER_TOKEN" ]] || fail "创建 runner 失败：$RUNNER_RESP"
  ok "runnerId=${RUNNER_ID}（token 只打印一次，本脚本不外传）"

  info "3. 配置节点定价（100/10/1/0 分每小时）"
  api PUT "/provider/pricing/$RUNNER_ID" '{"cpuHourCents":100,"memoryGiBHourCents":10,"diskGiBHourCents":1,"gpuHourCents":0}' >/dev/null
  PRICING=$(api GET /provider/pricing)
  json_get "$PRICING" items >/dev/null || fail "读取定价失败：$PRICING"
  ok "定价已保存"

  info "4. GET /provider/nodes（P1 节点视图）"
  NODES=$(api GET /provider/nodes)
  NODE_STATE=$(printf '%s' "$NODES" | python3 -c '
import json, sys
target = sys.argv[1]
items = json.load(sys.stdin).get("items", [])
match = [item for item in items if item.get("runnerId") == target]
print(match[0].get("state", "") if match else "")
' "$RUNNER_ID")
  [[ -n "$NODE_STATE" ]] || fail "节点列表里找不到刚建的 runner：$NODES"
  ok "节点可见：state=$NODE_STATE"

  info "5. GET /provider/nodes/:id/sandboxes（P1 沙箱列表）"
  SANDBOXES=$(api GET "/provider/nodes/$RUNNER_ID/sandboxes")
  [[ -n "$(json_get "$SANDBOXES" items 2>/dev/null || true)" ]] || fail "沙箱列表接口异常：$SANDBOXES"
  ok "沙箱列表接口正常（当前 $(echo "$SANDBOXES" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["items"]))') 个）"

  # ---------------------------------------------------------------- P2 usage
  info "6. 取 region 所属组织，注入 $DAY 的用量（模拟 2 个沙箱）"
  ORG_ID=$("${COMPOSE[@]}" exec -T "$SVC" psql -U user -d daytona -tAc \
    "SELECT \"organizationId\" FROM region WHERE id='$REGION_ID'")
  ORG_ID=$(printf '%s' "$ORG_ID" | tr -d '[:space:]')
  [[ -n "$ORG_ID" ]] || fail "查不到 region 所属组织"

  "${COMPOSE[@]}" exec -T "$SVC" psql -U user -d daytona -v ON_ERROR_STOP=1 -c "
    INSERT INTO sandbox_usage_periods
      (\"id\",\"sandboxId\",\"organizationId\",\"startAt\",\"endAt\",\"cpu\",\"gpu\",\"gpu_type\",\"mem\",\"disk\",\"region\",\"runnerId\")
    VALUES
      (uuid_generate_v4(),'acc-sbx-1','$ORG_ID','${DAY}T00:00:00Z','${DAY}T06:00:00Z',2,0,NULL,4,10,'$REGION_ID','$RUNNER_ID'),
      (uuid_generate_v4(),'acc-sbx-2','$ORG_ID','${DAY}T00:00:00Z','${DAY}T12:00:00Z',1,0,NULL,2,5,'$REGION_ID','$RUNNER_ID');
  " >/dev/null
  ok "已注入 2 条用量周期（共 24 CPU·h / 48 GiB·h 内存 / 120 GiB·h 磁盘）"

  info "7. GET /provider/usage（P2 用量聚合）"
  USAGE=$(api GET "/provider/usage?from=$DAY&to=$DAY&granularity=day&runnerId=$RUNNER_ID")
  USAGE_CPU=$(json_get "$USAGE" totals.cpuHours)
  USAGE_MEM=$(json_get "$USAGE" totals.memoryGiBHours)
  [[ "$USAGE_CPU" == "24" ]] || fail "CPU 用量应为 24，实际 ${USAGE_CPU}（${USAGE}）"
  [[ "$USAGE_MEM" == "48" ]] || fail "内存用量应为 48，实际 $USAGE_MEM"
  ok "用量正确：cpuHours=$USAGE_CPU memoryGiBHours=$USAGE_MEM diskGiBHours=$(json_get "$USAGE" totals.diskGiBHours)"

  # ---------------------------------------------------------------- P3 settlement
  info "8. POST /admin/provider/settlements/recompute（P3 结算重算）"
  RECOMPUTE=$(api POST "/admin/provider/settlements/recompute" "{\"day\":\"$DAY\"}" "$ADMIN_KEY")
  SETTLED_COUNT=$(json_get "$RECOMPUTE" settled)
  [[ "$SETTLED_COUNT" -ge 1 ]] || fail "重算结算失败：$RECOMPUTE"
  ok "重算完成，settled=$SETTLED_COUNT"

  info "9. GET /provider/settlements（P3 结算单）"
  SETTLEMENTS=$(api GET "/provider/settlements?from=$DAY&to=$DAY&runnerId=$RUNNER_ID")
  SETTLEMENT_ID=$(echo "$SETTLEMENTS" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data["items"]:
    print(item["id"])
    break
')
  SETTLEMENT_AMOUNT=$(echo "$SETTLEMENTS" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data["items"][0]["amountCents"])
')
  [[ -n "$SETTLEMENT_ID" ]] || fail "没有结算单：$SETTLEMENTS"
  # 期望：24 CPU·h * 100 + 48 GiB·h * 10 + 120 GiB·h * 1 = 2400 + 480 + 120 = 3000 分
  [[ "$SETTLEMENT_AMOUNT" == "3000" ]] || fail "结算金额应为 3000 分，实际 ${SETTLEMENT_AMOUNT}（${SETTLEMENTS}）"
  ok "结算单 $SETTLEMENT_ID 金额=${SETTLEMENT_AMOUNT} 分"

  info "10. GET /provider/earnings（P3 收益，已结算读结算表）"
  EARNINGS=$(api GET "/provider/earnings?from=$DAY&to=$DAY&runnerId=$RUNNER_ID")
  EARNINGS_AMOUNT=$(json_get "$EARNINGS" totals.amountCents)
  [[ "$EARNINGS_AMOUNT" == "$SETTLEMENT_AMOUNT" ]] || fail "收益金额 $EARNINGS_AMOUNT 与结算单 $SETTLEMENT_AMOUNT 不一致"
  ok "收益一致：${EARNINGS_AMOUNT} 分"

  info "11. POST /admin/provider/settlements/:id/settle（平台标记已结算）"
  api POST "/admin/provider/settlements/$SETTLEMENT_ID/settle" '' "$ADMIN_KEY" >/dev/null
  SETTLED=$(api GET "/provider/settlements?status=SETTLED&from=$DAY&to=$DAY")
  echo "$SETTLED" | grep -q "$SETTLEMENT_ID" || fail "结算单未变为 SETTLED：$SETTLED"
  ok "结算单状态已置为 SETTLED"

  # ---------------------------------------------------------------- P4 alerts
  if [[ "$WAIT_ALERTS" == "1" ]]; then
    info "12. 等待 ~75s 让节点离线告警触发（P4）"
    sleep 75
    ALERTS=$(api GET "/provider/alerts?state=open")
    ALERT_ID=$(echo "$ALERTS" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data["items"]:
    if item["type"] == "OFFLINE":
        print(item["id"])
        break
')
    [[ -n "$ALERT_ID" ]] || fail "没有触发 OFFLINE 告警：$ALERTS"
    ok "OFFLINE 告警已触发：$ALERT_ID"
    api POST "/provider/alerts/$ALERT_ID/resolve" >/dev/null
    ok "告警已 resolve"
  else
    info "12. 跳过告警等待（WAIT_ALERTS=1 可启用）"
  fi

  # ---------------------------------------------------------------- cleanup
  if [[ "$CLEANUP" == "1" ]]; then
    info "13. 清理验收资源"
    "${COMPOSE[@]}" exec -T "$SVC" psql -U user -d daytona -v ON_ERROR_STOP=1 -c "
      DELETE FROM sandbox_usage_periods WHERE \"sandboxId\" IN ('acc-sbx-1','acc-sbx-2');
      DELETE FROM sandbox_usage_periods_archive WHERE \"sandboxId\" IN ('acc-sbx-1','acc-sbx-2');
      DELETE FROM settlement_sandbox_lines WHERE \"runnerId\" = '$RUNNER_ID';
      DELETE FROM settlement_periods WHERE \"runnerId\" = '$RUNNER_ID';
      DELETE FROM runner_pricing WHERE \"runnerId\" = '$RUNNER_ID';
    " >/dev/null || true
    api DELETE "/runners/$RUNNER_ID" >/dev/null || true
    api DELETE "/regions/$REGION_ID" >/dev/null || true
    ok "已删除 runner / region / 注入的用量与结算数据"
  fi

  cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E2E 验收通过 ✅  P1 ✓ P2 ✓ P3 ✓ P4 $([[ "$WAIT_ALERTS" == "1" ]] && echo '✓' || echo '（跳过）')

接下来 Dashboard UI 手工验收：
1. 打开 http://127.0.0.1:3100，用 Dex 登录
2. 侧边栏 Infrastructure → 「算力控制台」应可见（需要 organization_infrastructure flag 开启）
3. 节点 tab：能看到 ${RUNNER_NAME}，状态/心跳/RTT/水位/沙箱数
4. 收益 tab：日期选 ${DAY}，应显示上面那笔 ${SETTLEMENT_AMOUNT} 分的收益与结算单
5. 告警 tab：节点离线约 1 分钟后出现 OFFLINE 告警，可点 resolve
6. （可选）在节点上真实跑一个沙箱 → 次日 01:00 自动结算，或调 recompute 立即结算
EOF
}

main "$@"
