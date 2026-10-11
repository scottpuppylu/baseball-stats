# Staging 部署與群組驗收狀態

日期：2026-10-12（Asia/Taipei）。起始版本 `c451d3737e14631a2c8678bbb3b8d00f59058e39`，分支 `codex/line-group-bot-v1`。GitHub 分支已推送，Draft PR：[feat(line-bot): LINE Group Graphical Bot V1](https://github.com/scottpuppylu/baseball-stats/pull/1)，目標 main，未合併。CI 尚在執行，未宣稱遠端 CI PASS。

## 已實際完成

- PASS：Wrangler OAuth 已登入使用者指定帳號 `e0655878527e6073466ff168fe3f90e4`，具 D1／Workers 寫入權限；未讀取或輸出 OAuth secret 值。
- PASS：本次重新執行 Bot 22/22 測試、正式 Worker 與 Staging dry-run。
- PASS：已建立獨立 APAC D1 `tk-aero-line-bot-staging`，UUID `24fa94a2-5a79-48e3-b0d7-4fd510202965`；config 的 `env.staging` binding 為 `DB`。
- PASS：遠端 `0001_line_bot_v1.sql` migration 已套用，11 個 Bot 資料表存在；再次列 migration 顯示沒有待套用版本。
- PASS：遠端 D1 隔離 SQL 探測，兩筆綁定、兩人獨立報名、狀態修改、較舊 timestamp 防覆蓋與 event ID 唯一性均通過。此為**實際遠端 D1、模擬身份資料**，不是 LINE 手機或 Worker→D1 完整驗收。
- PASS：探測資料已清理，再次查詢 members/matches/attendance/events 均為 0。正式網站與正式比賽 JSON 未修改，沒有真實 LINE 訊息。

機器可讀的本機證據：`.local/line-staging-d1-probe.json`。可重現探測：`node bot/scripts/d1-staging-probe.cjs`；只對固定 Staging binding 執行 UUID 標记測試並清除自己的資料，不操作 production。

## 部署結果與擁有者決定

FAIL：執行 `npm run bot:staging:deploy` 時 Cloudflare 拒絕 Worker upload，錯誤 **100328：CPU limits are not supported for the Free plan**。現有設定沿用原排棒模型需要的 `cpu_ms=30000`。沒有成功 deployment version ID，也沒有可提供的 Staging／Webhook URL。另以 deployments list 查詢確認 Worker 不存在（10007）。

擁有者已選擇「先保留 D1 與部署準備」。因此本次停止部署，不購買／升級方案、不移除 CPU 設定、不降低原排棒演算法、不使用臨時預覽帳號繞過阻擋。

BLOCKED：Cloudflare Workers 完整部署需先具備支援 CPU budget 的方案。LINE Channel Secret／Access Token 尚未設定；真實 Webhook、Worker 的遠端 D1 runtime binding、Bot 入群、白名單與隊長綁定尚未驗證。

## 真實手機驗收

| 項目 | 本機 Mock | 真實 LINE 手機／群組 |
| --- | --- | --- |
| Flex 主選單 | PASS | NOT_TESTED |
| 個人數據 | PASS | NOT_TESTED |
| 排行榜 | PASS | NOT_TESTED |
| 球員比較 | PASS | NOT_TESTED |
| 智慧排棒 | PASS | NOT_TESTED |
| 比賽報名 | PASS | NOT_TESTED |
| 賽後戰報 | PASS | NOT_TESTED |
| 多人互動／權限／Webhook 去重 | PASS | NOT_TESTED |

## 之後恢復部署的最短步驟

1. 擁有者若決定啟用 Workers Paid，先在 Cloudflare 檢視並完成計費方案變更；不由 agent 代購。
2. 沿用既有 Staging D1，不再次建立資料庫，執行 `npm run bot:staging:deploy`，以實際輸出的 URL 驗證 `/health`。
3. **成功部署後**由擁有者於安全終端執行以下 secret 命令，或在 Staging Worker Settings → Variables and Secrets 新增 Secret。不可把值貼到聊天／GitHub：

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET --config bot/wrangler.jsonc --env staging
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config bot/wrangler.jsonc --env staging
```

4. LINE Developers 設定實際 HTTPS `/webhook`，開啟 Use Webhook、Allow bot to join group chats，執行 Verify。
5. 邀請 Bot 到獨立一般測試群，核對 discovery 的 Group ID、設定可信隊長 User ID、群組白名單與資料分享同意，再做 A–I 手機驗收。完整 10/11 棒須足夠真實已核准的出席隊員。
6. 通過實機驗收後，正式群組啟用與主動群發仍須另外明確授權。保持 `ENABLE_PUSH=false` 直到完成該授權。

Rollback checkpoint 保留 `checkpoint-line-safe-baseline-v1` / `60d51aa`；它不含 Worker。這次沒有成功 Worker 部署需要回退，D1 保留供後續使用，不刪除。沒有合併 main 或重寫歷史。舊 Token 依使用者定案不列 release blocker。
