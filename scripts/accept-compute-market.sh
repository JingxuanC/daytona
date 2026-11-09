#!/usr/bin/env bash
# 算力市场 M1 验收脚本（两组织 E2E）
#
# 前提：本地 docker-compose 栈在跑（db/redis/api 可用），且存在一个可用的自定义 region + ready 的 runner。
# 用法：
#   bash scripts/accept-compute-market.sh
#   API=http://127.0.0.1:3100/api ADMIN_KEY=localdev-admin-key bash scripts/accept-compute-market.sh
set -uo pipefail

API="${API:-http://127.0.0.1:3100/api}"
ADMIN_KEY="${ADMIN_KEY:-localdev-admin-key}"
COMPOSE_FILES=(-f docker/docker-compose.yaml -f "${COMPOSE_OVERRIDE:-/tmp/daytona-deps.override.yaml}")
PROVIDER_KEY="dtn_e2e_market_provider_key"
PROVIDER_KEY_NAME="e2e-market-provider"
LISTING_NAME="e2e-market-listing"
SNAPSHOT_NAME="e2e-market-snap"
TODAY=$(date -u +%Y-%m-%d)
PASS=0
FAIL=0

info() { printf '\n→ %s\n' "$*"; }
ok() { PASS=$((PASS + 1)); printf '✓ %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '✗ %s\n' "$*"; }

psql_db() {
  docker compose "${COMPOSE_FILES[@]}" exec -T db psql -U user -d daytona -tAc "$1"
}

api() {
  local method=$1 path=$2 key=$3 body=${4:-}
  if [ -n "$body" ]; then
    curl -s -X "$method" "$API$path" -H "Authorization: Bearer $key" -H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}'
  else
    curl -s -X "$method" "$API$path" -H "Authorization: Bearer $key" -w '\n%{http_code}'
  fi
}

json_get() {
  python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)
for key in sys.argv[1].split("."):
    if isinstance(data, list):
        try:
            data = data[int(key)]
        except Exception:
            data = None
    elif isinstance(data, dict):
        data = data.get(key)
    else:
        data = None
    if data is None:
        break
print("" if data is None else data)
' "$1"
}

delete_snapshot_and_wait() {
  local sid
  sid=$(psql_db "SELECT id FROM snapshot WHERE name='$SNAPSHOT_NAME' AND \"organizationId\"='$CONSUMER_ORG' LIMIT 1")
  if [ -n "$sid" ]; then
    curl -s -X DELETE "$API/snapshots/$sid" -H "Authorization: Bearer $ADMIN_KEY" >/dev/null || true
  fi
  for _ in $(seq 1 25); do
    [ -z "$(psql_db "SELECT id FROM snapshot WHERE name='$SNAPSHOT_NAME' AND \"organizationId\"='$CONSUMER_ORG' LIMIT 1")" ] && return 0
    sleep 2
  done
  return 0
}

# ---------- 0. 健康检查 & 解析 provider / consumer ----------
info "0. 环境检查"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$API/config")
[ "$HTTP" = "200" ] || { fail "API 不可用（$API/config -> ${HTTP}）"; exit 1; }
ok "API 就绪"

READY_RUNNER=$(psql_db "SELECT r.id FROM runner r JOIN region reg ON reg.id = r.region WHERE r.state = 'ready' AND reg.\"organizationId\" IS NOT NULL AND reg.\"regionType\" = 'custom' LIMIT 1")
[ -n "$READY_RUNNER" ] || { fail "找不到可用的自定义 region + ready runner（先在 Infrastructure 里建 region 并启动 runner）"; exit 1; }
PROV_ORG=$(psql_db "SELECT reg.\"organizationId\" FROM runner r JOIN region reg ON reg.id = r.region WHERE r.id = '$READY_RUNNER'")
REGION_ID=$(psql_db "SELECT region FROM runner WHERE id = '$READY_RUNNER'")
PROV_USER=$(psql_db "SELECT \"userId\" FROM organization_user WHERE \"organizationId\" = '$PROV_ORG' LIMIT 1")
CONSUMER_ORG=$(psql_db "SELECT \"organizationId\" FROM api_key WHERE name = 'daytona-admin' LIMIT 1")
[ "$PROV_ORG" != "$CONSUMER_ORG" ] || { fail "provider 与 consumer 不能是同一个组织（脚本需要两个组织）"; exit 1; }
ok "provider=$PROV_ORG region=$REGION_ID runner=$READY_RUNNER consumer=$CONSUMER_ORG"

# ---------- 1. mint provider API key ----------
info "1. 为 provider 组织签发临时 API key"
KEY_HASH=$(printf '%s' "$PROVIDER_KEY" | shasum -a 256 | cut -d' ' -f1)
psql_db "DELETE FROM api_key WHERE name = '$PROVIDER_KEY_NAME'" >/dev/null
psql_db "INSERT INTO api_key (\"organizationId\",\"userId\",name,\"keyHash\",\"keyPrefix\",\"keySuffix\",permissions,\"createdAt\") VALUES ('$PROV_ORG','$PROV_USER','$PROVIDER_KEY_NAME','$KEY_HASH','dtn_','_key', ARRAY['read:runners','write:runners','delete:runners','write:regions','write:sandboxes','delete:sandboxes','write:snapshots','read:volumes','write:volumes']::api_key_permissions_enum[], now())" >/dev/null
[ "$(psql_db "SELECT count(*) FROM api_key WHERE name = '$PROVIDER_KEY_NAME'")" = "1" ] || { fail "provider key 插入失败"; exit 1; }
ok "provider key 已签发"

# ---------- 2. 清理上一次运行的残留 ----------
info "2. 清理上一次运行的残留"
delete_snapshot_and_wait
for STALE_ID in $(psql_db "SELECT id FROM sandbox WHERE \"organizationId\"='$CONSUMER_ORG' AND \"snapshot\"='$SNAPSHOT_NAME' AND state <> 'destroyed'"); do
  curl -s -X DELETE "$API/sandbox/$STALE_ID" -H "Authorization: Bearer $ADMIN_KEY" >/dev/null || true
done
for _ in $(seq 1 15); do
  LEFT=$(psql_db "SELECT count(*) FROM sandbox WHERE \"organizationId\"='$CONSUMER_ORG' AND \"snapshot\"='$SNAPSHOT_NAME' AND state <> 'destroyed'")
  [ "${LEFT:-0}" = "0" ] && break
  sleep 2
done
psql_db "UPDATE sandbox SET state='destroyed', \"desiredState\"='destroyed' WHERE \"organizationId\"='$CONSUMER_ORG' AND \"snapshot\"='$SNAPSHOT_NAME' AND state <> 'destroyed'" >/dev/null || true
psql_db "DELETE FROM market_credit_entries WHERE \"organizationId\"='$CONSUMER_ORG' AND \"referenceId\" IN (SELECT id::text FROM market_usage_charges WHERE \"consumerOrganizationId\"='$CONSUMER_ORG')" >/dev/null || true
psql_db "DELETE FROM market_credit_entries WHERE \"organizationId\"='$CONSUMER_ORG' AND \"description\"='E2E topup'" >/dev/null || true
psql_db "DELETE FROM market_usage_charges WHERE \"consumerOrganizationId\"='$CONSUMER_ORG'" >/dev/null || true
psql_db "DELETE FROM market_leases WHERE \"consumerOrganizationId\"='$CONSUMER_ORG' AND \"listingId\"::text NOT IN (SELECT id::text FROM market_listings)" >/dev/null || true
ok "旧测试数据已清理"

# ---------- 3. provider 上架 ----------
info "3. provider 上架容量（100/10/1 分，容量 8c/16GiB/50GiB）"
LISTING_RESP=$(api POST /provider/market/listings "$PROVIDER_KEY" "{\"regionId\":\"$REGION_ID\",\"name\":\"$LISTING_NAME\",\"cpuHourCents\":100,\"memoryGiBHourCents\":10,\"diskGiBHourCents\":1,\"totalCpu\":8,\"totalMemoryGiB\":16,\"totalDiskGiB\":50,\"maxCpuPerSandbox\":4,\"maxMemoryPerSandbox\":8,\"maxDiskPerSandbox\":20}")
LISTING_ID=$(echo "$LISTING_RESP" | head -1 | json_get id)
[ -n "$LISTING_ID" ] || { fail "上架失败：$LISTING_RESP"; exit 1; }
ok "listingId=$LISTING_ID"

info "3.5. M2：为 consumer 充值 1000 分并校验余额"
TOPUP=$(api POST /admin/market/credits/topup "$ADMIN_KEY" "{\"organizationId\":\"$CONSUMER_ORG\",\"amountCents\":1000,\"description\":\"E2E topup\"}")
BALANCE=$(echo "$TOPUP" | head -1 | json_get balanceCents)
[ "${BALANCE:-0}" = "1000" ] && ok "余额已充值：$BALANCE 分" || fail "充值失败：$TOPUP"

# ---------- 4. consumer 浏览 + 租用 ----------
info "4. consumer 浏览并租用 4c/8GiB/20GiB"
BROWSE=$(api GET /market/listings "$ADMIN_KEY")
[ "$(echo "$BROWSE" | head -1 | json_get items.0.id)" = "$LISTING_ID" ] || fail "浏览列表里没有新上架算力：$BROWSE"
[ "$FAIL" = "0" ] && ok "市场列表可见"
LEASE_RESP=$(api POST /market/leases "$ADMIN_KEY" "{\"listingId\":\"$LISTING_ID\",\"totalCpu\":4,\"totalMemoryGiB\":8,\"totalDiskGiB\":20}")
LEASE_ID=$(echo "$LEASE_RESP" | head -1 | json_get id)
[ -n "$LEASE_ID" ] || { fail "开租约失败：$LEASE_RESP"; exit 1; }
ok "leaseId=$LEASE_ID"

info "5. consumer 可用 regions 包含该 market region"
REGIONS=$(api GET /regions "$ADMIN_KEY")
if echo "$REGIONS" | head -1 | grep -q "$REGION_ID"; then ok "region 已可见"; else fail "available regions 里没有 ${REGION_ID}：$REGIONS"; fi

info "5.5. M3：排序 + 平台运营视图"
SORTED=$(api GET "/market/listings?sort=price_asc" "$ADMIN_KEY" | head -1)
SORT_OK=$(echo "$SORTED" | python3 -c '
import json, sys
items = json.load(sys.stdin).get("items", [])
prices = [i["cpuHourCents"] + i["memoryGiBHourCents"] + i["diskGiBHourCents"] for i in items]
print("1" if prices == sorted(prices) else "0")
')
[ "$SORT_OK" = "1" ] && ok "price_asc 排序正确" || fail "price_asc 排序异常：$SORTED"
OVERVIEW=$(api GET /admin/market/overview "$ADMIN_KEY")
echo "$OVERVIEW" | head -1 | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert "listings" in d and "activeLeases" in d and "charges" in d and "negativeBalanceOrganizations" in d, d
assert d["activeLeases"] >= 1, d
print("1")
' >/dev/null && ok "运营概览端点正常（activeLeases>=1）" || fail "运营概览异常：$OVERVIEW"

# ---------- 6. consumer 建快照 + 沙箱（target=market region） ----------
info "6. consumer 在 market region 建快照"
delete_snapshot_and_wait
api POST /snapshots "$ADMIN_KEY" "{\"name\":\"$SNAPSHOT_NAME\",\"imageName\":\"ubuntu:24.04\",\"regionId\":\"$REGION_ID\",\"cpu\":1,\"memory\":1,\"disk\":3,\"entrypoint\":[\"sleep\",\"infinity\"]}" >/dev/null
SNAP_STATE=""
for _ in $(seq 1 40); do
  SNAP_STATE=$(api GET "/snapshots/$SNAPSHOT_NAME" "$ADMIN_KEY" | head -1 | json_get state)
  case "$SNAP_STATE" in active) break;; error) break;; esac
  sleep 3
done
if [ "$SNAP_STATE" = "active" ]; then ok "snapshot active"; else fail "snapshot 未就绪（state=${SNAP_STATE}）"; fi

info "7. consumer 创建沙箱（target=market region）"
SANDBOX_RESP=$(api POST /sandbox "$ADMIN_KEY" "{\"snapshot\":\"$SNAPSHOT_NAME\",\"target\":\"$REGION_ID\"}")
SANDBOX_ID=$(echo "$SANDBOX_RESP" | head -1 | json_get id)
[ -n "$SANDBOX_ID" ] || { fail "创建沙箱失败：$SANDBOX_RESP"; exit 1; }
SANDBOX_STATE=""
for _ in $(seq 1 40); do
  SANDBOX_STATE=$(api GET "/sandbox/$SANDBOX_ID" "$ADMIN_KEY" | head -1 | json_get state)
  case "$SANDBOX_STATE" in started) break;; error) break;; esac
  sleep 3
done
if [ "$SANDBOX_STATE" = "started" ]; then ok "sandbox started"; else fail "sandbox 未启动（state=${SANDBOX_STATE}）"; fi

# ---------- 8. 归因：provider 用量/结算 + consumer 用量 ----------
info "8. 等待用量落库，验证归因与计费"
CONSUMER_USAGE=0
for _ in $(seq 1 30); do
  CONSUMER_USAGE=$(api GET "/market/usage?from=$TODAY&to=$TODAY" "$ADMIN_KEY" | head -1 | json_get totals.amountCents)
  [ -n "$CONSUMER_USAGE" ] && [ "$CONSUMER_USAGE" -gt 0 ] && break
  sleep 3
done
[ "${CONSUMER_USAGE:-0}" -gt 0 ] && ok "consumer 市场用量 amount=${CONSUMER_USAGE} 分" || fail "consumer 市场用量为 0"

PROVIDER_USAGE=$(api GET "/provider/usage?from=$TODAY&to=$TODAY&runnerId=$READY_RUNNER" "$PROVIDER_KEY" | head -1 | json_get items.0.cpuHours)
[ -n "$PROVIDER_USAGE" ] && [ "$(python3 -c "print(1 if float('${PROVIDER_USAGE:-0}') > 0 else 0)")" = "1" ] && ok "provider 节点用量 cpuHours=$PROVIDER_USAGE" || fail "provider 节点用量缺失"

RECOMPUTE=$(api POST /admin/provider/settlements/recompute "$ADMIN_KEY" "{\"day\":\"$TODAY\"}")
SETTLED=$(echo "$RECOMPUTE" | head -1 | json_get settled)
[ "${SETTLED:-0}" -ge 1 ] && ok "结算重算 settled=$SETTLED" || fail "结算重算失败：$RECOMPUTE"
SETTLEMENT_AMOUNT=$(api GET "/provider/settlements?from=$TODAY&to=$TODAY&runnerId=$READY_RUNNER" "$PROVIDER_KEY" | head -1 | json_get items.0.amountCents)
[ "${SETTLEMENT_AMOUNT:-0}" -gt 0 ] && ok "provider 结算单金额=${SETTLEMENT_AMOUNT} 分" || fail "provider 结算单金额为 0"

info "8.5. M2：扣费任务 + 账本 + 抽成校验"
CHARGED=$(api POST /admin/market/charges/recompute "$ADMIN_KEY" "{\"day\":\"$TODAY\"}" | head -1 | json_get charged)
[ "${CHARGED:-0}" -ge 1 ] && ok "扣费任务执行（$CHARGED 个租约）" || fail "扣费任务未产生扣费：$CHARGED"
CHARGE_AMOUNT=$(api GET "/market/charges?from=$TODAY&to=$TODAY" "$ADMIN_KEY" | head -1 | json_get items.0.amountCents)
CHARGE_FEE=$(api GET "/market/charges?from=$TODAY&to=$TODAY" "$ADMIN_KEY" | head -1 | json_get items.0.platformFeeCents)
CHARGE_NET=$(api GET "/market/charges?from=$TODAY&to=$TODAY" "$ADMIN_KEY" | head -1 | json_get items.0.providerNetCents)
[ "${CHARGE_AMOUNT:-0}" -gt 0 ] && ok "扣费金额=$CHARGE_AMOUNT 分（平台费 $CHARGE_FEE / 净收益 ${CHARGE_NET}）" || fail "扣费金额为 0"
[ "$(( CHARGE_FEE + CHARGE_NET ))" = "$CHARGE_AMOUNT" ] && ok "扣费拆分正确：平台费 + 净收益 = 扣费金额" || fail "扣费拆分不一致"
BALANCE_AFTER=$(api GET /market/credit "$ADMIN_KEY" | head -1 | json_get balanceCents)
EXPECTED_BALANCE=$((1000 - CHARGE_AMOUNT))
[ "${BALANCE_AFTER:-0}" = "$EXPECTED_BALANCE" ] && ok "账本余额正确：$BALANCE_AFTER 分" || fail "账本余额异常：${BALANCE_AFTER}（期望 ${EXPECTED_BALANCE}）"
SETTLE_FEE=$(api GET "/provider/settlements?from=$TODAY&to=$TODAY&runnerId=$READY_RUNNER" "$PROVIDER_KEY" | head -1 | json_get items.0.platformFeeCents)
SETTLE_NET=$(api GET "/provider/settlements?from=$TODAY&to=$TODAY&runnerId=$READY_RUNNER" "$PROVIDER_KEY" | head -1 | json_get items.0.netCents)
SETTLE_AMOUNT=$(api GET "/provider/settlements?from=$TODAY&to=$TODAY&runnerId=$READY_RUNNER" "$PROVIDER_KEY" | head -1 | json_get items.0.amountCents)
[ "$(( ${SETTLE_FEE:-0} + ${SETTLE_NET:-0} ))" = "${SETTLE_AMOUNT:-0}" ] && ok "结算抽成正确：费用 $SETTLE_FEE + 净额 $SETTLE_NET = 流水 $SETTLE_AMOUNT" || fail "结算抽成不一致"

# ---------- 9. 关租约后拒绝新建沙箱 ----------
info "9. 关闭租约，验证授权回收"
api POST "/market/leases/$LEASE_ID/close" "$ADMIN_KEY" >/dev/null
REGIONS_AFTER=$(api GET /regions "$ADMIN_KEY")
if echo "$REGIONS_AFTER" | head -1 | grep -q "$REGION_ID"; then fail "关闭租约后 region 仍然可见"; else ok "market region 已从可用列表移除"; fi
REJECT=$(api POST /sandbox "$ADMIN_KEY" "{\"snapshot\":\"$SNAPSHOT_NAME\",\"target\":\"$REGION_ID\"}")
if echo "$REJECT" | head -1 | grep -q '"statusCode"'; then ok "关闭租约后创建沙箱被拒绝（$(echo "$REJECT" | head -1 | json_get statusCode)）"; else fail "关闭租约后仍可创建沙箱：$REJECT"; fi

# ---------- 10. 清理 ----------
info "10. 清理测试资源"
curl -s -X DELETE "$API/sandbox/$SANDBOX_ID" -H "Authorization: Bearer $ADMIN_KEY" >/dev/null || true
for _ in $(seq 1 20); do
  ST=$(api GET "/sandbox/$SANDBOX_ID" "$ADMIN_KEY" | head -1 | json_get state)
  [ "$ST" = "destroyed" ] || [ "$ST" = "" ] && break
  sleep 2
done
psql_db "UPDATE sandbox SET state='destroyed', \"desiredState\"='destroyed' WHERE id='$SANDBOX_ID'" >/dev/null || true
delete_snapshot_and_wait
curl -s -X DELETE "$API/provider/market/listings/$LISTING_ID" -H "Authorization: Bearer $PROVIDER_KEY" >/dev/null || true
psql_db "DELETE FROM market_credit_entries WHERE \"organizationId\"='$CONSUMER_ORG' AND \"referenceId\" IN (SELECT id::text FROM market_usage_charges WHERE \"listingId\"='$LISTING_ID')" >/dev/null || true
psql_db "DELETE FROM market_credit_entries WHERE \"organizationId\"='$CONSUMER_ORG' AND \"description\"='E2E topup'" >/dev/null || true
psql_db "DELETE FROM market_usage_charges WHERE \"listingId\"='$LISTING_ID'" >/dev/null || true
psql_db "DELETE FROM market_leases WHERE \"listingId\"='$LISTING_ID'" >/dev/null || true
psql_db "DELETE FROM market_listings WHERE id='$LISTING_ID'" >/dev/null || true
psql_db "DELETE FROM api_key WHERE name='$PROVIDER_KEY_NAME'" >/dev/null || true
# 恢复 region 的原状（脚本会开启配额校验并创建 provider 自用配额）
psql_db "DELETE FROM region_quota WHERE \"regionId\"='$REGION_ID' AND \"organizationId\"='$PROV_ORG'" >/dev/null || true
psql_db "UPDATE region SET \"enforceQuotas\"=false WHERE id='$REGION_ID'" >/dev/null || true
ok "清理完成"

printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
if [ "$FAIL" -eq 0 ]; then
  printf '算力市场 E2E 通过 ✅  （%s 项检查）\n' "$PASS"
  exit 0
else
  printf '算力市场 E2E 失败 ❌  （通过 %s，失败 %s）\n' "$PASS" "$FAIL"
  exit 1
fi
