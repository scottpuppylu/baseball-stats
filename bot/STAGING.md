# V1 Staging 部署與一般群組實機驗收

本次沿用 `bot/wrangler.jsonc` 與 `src/worker.ts`，選取 `--env staging`。Worker 名稱固定為 `tk-aero-line-group-bot-staging`；D1 名稱固定為 `tk-aero-line-bot-staging`、binding 固定為 `DB`。不得使用 `tests/wrangler-smoke.jsonc` 做遠端部署。正式網站、GitHub Pages、production Worker 均不在本次部署範圍。

實際完成與未驗收狀態請看 [Staging 狀態紀錄](STAGING-STATUS.md)。既有 Staging D1 已建立，不要重複建立；Worker 因 Free CPU 限制未部署成功，擁有者選擇保留準備。

本次授權：推送 `codex/line-group-bot-v1`、建立不自動合併的 PR、建立／部署獨立 Staging Worker 與 D1。正式群組啟用及主動推播另需授權。依使用者定案，既有 GitHub Token 問題不作為本次 release blocker；不調查舊 Token、不重寫歷史，也不要求撤銷才能部署。

## 最少必要設定

1. Cloudflare 未登入時，在專案終端執行 `npx wrangler login`，於瀏覽器登入並核准 Wrangler。不要在聊天中傳 Cloudflare API Token。
2. 建立／確認 LINE 測試官方帳號：Official Account Manager 啟用 Messaging API，再到 LINE Developers 該 channel 的 Messaging API 頁面取得 Secret／Access Token。不要使用正式群組作為第一個驗收環境。
3. 將 LINE 憑證安全存入 Staging（Wrangler 的互動 secret 輸入不提交到 Git）：

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET --config bot/wrangler.jsonc --env staging
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config bot/wrangler.jsonc --env staging
```

也可在 Cloudflare Worker Settings → Variables and Secrets 新增 **Secret** 類型的兩個變數。不可把值填進 `vars`、PR、README 或聊天；本機的 `.dev.vars.staging` 必須保持 ignored。

## Staging 初始化與部署

```powershell
npx wrangler d1 list
# 若固定名稱尚不存在才建立，避免重複 DB。
npx wrangler d1 create tk-aero-line-bot-staging
# 把回傳 UUID 填入 env.staging.d1_databases[0].database_id。
npm run bot:staging:migrate
npx wrangler d1 execute DB --remote --config bot/wrangler.jsonc --env staging --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npm run bot:staging:build
npm run bot:staging:deploy
```

以實際 deploy 輸出的 URL 為準，不自行猜測 workers.dev 子網域。新環境沒有 LINE secrets 時 `/health` 仍能運作並回傳 `configured:false`；`/webhook` 回傳 503，這不是 LINE 連通驗收。

部署後驗證 `/health`、未簽章 `/webhook` 被拒絕，並在 LINE Developers 填 `https://實際部署網域/webhook`，按 Verify。唯有真實 LINE Verify 成功且遠端日誌／D1 有對應證據，才標示 LINE Webhook PASS。程式只在原始 body 驗證簽章後解析；禁止關閉簽章驗證。

Staging 初始 `ENABLE_PUSH=false`、兩項推播預算為 0、群組白名單空白、數據分享關閉。可安全先部署後設定測試群；不要用自動化推播替代手機按鈕驗收。

## 測試群組與權限

建立一般 LINE 測試群組，含一名隊長、兩名隊員及 Bot。啟用 Use Webhook、Allow bot to join group chats，關閉官方帳號預設自動回覆避免重複訊息。加官方帳號好友，再邀請進測試群；群組入口為「選單」，不使用一對一 Rich Menu。

Bot 加入後透過已簽章的 group event 發現 Group ID：

```powershell
npx wrangler d1 execute DB --remote --config bot/wrangler.jsonc --env staging --command "SELECT group_id,first_seen FROM bot_discovery ORDER BY first_seen DESC"
```

核對測試群後，填入 staging 的 `ALLOWED_GROUP_IDS`；隊長 LINE Developers Basic settings 的 Your user ID 填入 `BOT_OWNER_USER_IDS`。不能依群組名稱授權，不收集全部群組成員 ID。隊長與隊員透過群組身分綁定申請，隊長確認本人後核准。取得資料分享同意後才把 staging 的 `ALLOW_PUBLIC_STATS` 設為 `true` 並重新部署一次。

## 實機驗收表

每一項要有真實手機操作及必要 D1／日誌證據。沒有操作一律 `NOT_TESTED`，Mock PASS 另列。

| 項目 | 操作與驗收條件 | 初始實機狀態 |
| --- | --- | --- |
| A 主選單 | 群組輸入「選單」；同群六項 Flex 按鈕可點 | NOT_TESTED |
| B 個人數據 | 選球員，核心統計／最近五場／生涯值與網站一致 | NOT_TESTED |
| C 排行榜 | 切換 AVG/OPS/wRC+、PA 門檻及分頁 | NOT_TESTED |
| D 雙人比較 | 兩次選擇與優勢卡片；其他人不能使用我的選擇卡 | NOT_TESTED |
| E 排棒 | 同場至少 10/11 名**真實且已核准綁定的不同出席隊員**；完整守位、原模型；只有教練／隊長可確認 | NOT_TESTED |
| F 報名 | 隊長建立未來測試賽程；三人出席／待定／請假，更改後查 D1；不覆蓋他人 | NOT_TESTED |
| G 戰報 | 選既有正式完賽資料，比分、MVP、生涯紀錄與網站一致，不修改場記 | NOT_TESTED |
| H 多人互動 | 兩人同時查不同球員／排行／報名；session 分開 | NOT_TESTED |
| I 權限／洗版 | 未核准不能報名、一般隊員不能確認打線、非白名單被拒、普通聊天不回覆 | NOT_TESTED |
| Webhook 重送 | 對實際事件核對唯一 event／attendance，不能重複計算或重複發送 | NOT_TESTED |

三名人類成員足以測試報名及多人查詢，**不足以驗收完整 10／11 棒**。不得偽造 11 個 LINE 帳號綁定填滿正式名單，也不得讓三個帳號各冒充多位球員；若人數不足，先驗證「不足人數」提醒，完整排棒維持 NOT_TESTED，安排足夠真實測試隊員後驗收。

在同一測試賽程下讀取持久化狀態（只查測試 D1）：

```powershell
npx wrangler d1 execute DB --remote --config bot/wrangler.jsonc --env staging --command "SELECT m.name,a.status,a.version,a.updated_at FROM bot_attendance a JOIN bot_matches g ON g.id=a.match_id JOIN bot_members m ON m.user_id=a.user_id AND m.group_id=g.group_id ORDER BY g.starts,m.name"
```

保留遠端 observation 日誌；不要記錄 Secret、Access Token、完整 webhook body 或普通聊天內容。排查僅用 HTTP 狀態、時間、事件處理狀態與 action 稽核，不把 LINE User ID／簽章貼到公開 PR。

## 正式啟用與回滾

正式啟用必須先完成以上實機驗收，再由擁有者明確授權正式群組與通知。正式 Worker/D1、群組白名單、隊長 ID 要分開設定；Staging 成功不代表 production 成功。不更動正式網站部署或雲端寫入行為。

若部署版本需要退回，先保持 `ENABLE_PUSH=false`；使用 Cloudflare 前一個已驗證部署版本回滾，備份並保留 D1 綁定／報名資料，不刪 DB。若這是第一個尚未驗收的 Staging 部署，可停止 Webhook 並保留測試 DB；Git 的 `checkpoint-line-safe-baseline-v1` 是網站安全 checkpoint，**沒有 Bot Worker，不可當作可部署的 Bot 回滾版本**。真正 Worker 回滾以 deploy version ID 為準。

官方參考：[Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)、[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[LINE 群組功能](https://developers.line.biz/en/docs/messaging-api/group-chats/)。
