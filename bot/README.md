# 淡江航太系壘 LINE 一般群組機器人 V1

這是官方 Messaging API 群組 Bot。隊員在同一個一般群組輸入「選單」，使用 Flex Carousel、Postback、Quick Reply 與原生日期時間選擇器。主程式只有 `/health`、`/webhook` 與排程，沒有另建網站、Rich Menu 或一對一查詢依賴。

## 本機執行與驗證

需要 Node.js 22.13+（本機 SQLite）或較新 LTS、npm；瀏覽器一致性與原網站測試需要 Google Chrome。

```powershell
npm ci
npm run bot:test
npm run bot:consistency
npm run bot:worker-smoke
npm run bot:build
npm run bot:security
npm test
npm run bot:replay
npm run bot:mock
```

`bot:mock` 只監聽 `127.0.0.1:8788`，不讀取正式 LINE 憑證、不連線 LINE/GitHub。資料為明確標示的 frozen fixtures；SQLite 持久化於 `.local/line-mock/state.sqlite`，不是正式賽事資料。

```powershell
$body = @{text='選單'} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8788/mock/event -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
# 點按等效操作：將回傳卡片 action.data 原文傳回；不要自己改 flow/version。
$body = @{data='a=pick&kind=stats'} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8788/mock/event -Method Post -ContentType 'application/json' -Body $body
```

測試身份：隊長 `U` 加 32 個 `a`；可用 `user` 欄位模擬不同隊員。關閉後重開保留綁定與報名。Ctrl+C 關閉模擬器。`bot:replay` 會在 `.local/line-flex/` 產生 12 份原生 LINE payload；可貼入官方 Flex Message Simulator 做視覺檢查。它使用獨立記憶體資料庫，沒有真實通知。

`bot:worker-smoke` 使用**獨立測試 Worker**、真正本機 workerd/D1、每次新的持久化目錄與 Mock transport，驗證簽章、兩人同時報名和事件去重。不要部署 `bot/tests/wrangler-smoke.jsonc`。正式設定是 `bot/wrangler.jsonc`。

## 群組中的六大流程

| 功能 | 群組內操作 |
| --- | --- |
| 個人數據 | 選單 → 個人數據 → 球員卡／下一頁 → 姓名、背號、公開 HTTPS 頭像、PA/AB/H/HR、AVG/OBP/SLG/OPS/wRC+/wOBA、最近五場、生涯摘要 |
| 球隊排行榜 | 選單 → 排行榜 → Quick Reply 切換 8 指標與最低 PA → 前三名、完整榜單分頁 |
| 球員比較 | 選單 → 比較 → 依序點兩位球員 → 7 指標、優勢、小樣本提醒；選擇狀態屬於點選者 |
| 智慧排棒 | 選單 → 智慧排棒 → 選比賽 → 10 棒／11 棒 DH → 已出席者推薦、守位、理由、90 分鐘預估得分 → 教練確認 |
| 比賽報名 | 隊長管理 → 建立比賽 → 日期／集合／截止原生選擇器 → 同群輸入地點、對手、備註 → 確認；已綁定隊員點出席／待定／請假，可更改 |
| 賽後戰報 | 選單 → 戰報 → 正式已完賽場記 → 比分、MVP、主要表現、全隊安打保送與生涯里程碑 |

日期統一 UTC+8。建立賽程會寫入 Bot 自己的 D1 排程；不會改寫網站的正式場記。隊長的文字建立流程有期限，可輸入「取消」或「選單」退出。其他隊員的普通聊天不會被當作隊長欄位。

初次報名：選單 Quick Reply「身分綁定」→ 球員 → 同意群組顯示姓名與報名 → 送出申請 → 隊長核對本人後核准。隊長可在管理選單核准球員或教練；自選姓名不會自動取得權限，已占用的球員不可覆蓋。

未回覆名單只包括**已核准且仍有效的綁定隊員**；不聲稱能列出全部 LINE 群組成員。查詢卡與結果對群組所有人可見，因此啟用數據分享必須先取得球隊同意。

## 相同資料、統計與模型

- 正式唯讀來源是網站原本的 `data` branch：`logs/games/defense/avatars/guests.json`。來源失敗會回覆錯誤，不替換為模擬數據。
- `scripts/build-engine.cjs` 以 TypeScript AST 擷取 `index.html` 的原統計聚合、場記同步、最低 PA 規則及守位函式，連同原 `team-insights.js` 的最近場次、生涯、MVP 算法，產生可在 Worker 執行的 facade。
- `lineup-model.js` 原文與 `lineup-recommender.js` 原推薦演算法被納入 generated module；僅排除 DOM 呈現 hook，沒有另建簡化排棒模型。
- 修改上述網站來源後執行 `npm run bot:engine`。CI 的 `bot:check-engine` 比對來源 hash 與產物，避免兩套演算法漂移。
- `bot:consistency` 使用真正原網站瀏覽器作為獨立基準，比對全部統計、最近五場、生涯里程碑、MVP／戰報及 10/11 棒（含原鎖棒）完整輸出，浮點容忍 `1e-12`；報告 `.local/line-consistency.json`。
- 比率榜預設原網站規則：最高 PA 的一半、至少 5 PA；計數榜預設不限 PA。可明確切換全部／PA14／PA30。小樣本標註不改變原公式。
- D1 不存第二套球員統計；只保存綁定、賽程、報名、選擇流程、推薦確認、通知與稽核。推薦確認時檢查資料來源 fingerprint、出席名單與 15 分鐘有效期，並在原子 SQL 更新中再核對名單。

## 安全與正式資料寫入界線

**先撤銷曾暴露的 GitHub Token。** 前端已移除可還原的憑證陣列與 GitHub 授權寫入；移除程式碼不等於撤銷憑證。擁有者必須到 GitHub token settings 撤銷舊 Token、檢查可存取 repo 與近期異常操作。不要在聊天中提供 Token。既有 Git 歷史沒有被重寫，歷史版本與已部署舊頁仍可能有洩漏。

網站的公開讀取、統計、分析、排棒、場記與本機保存保留；原雲端寫入改為同來源 `/api/documents/...`，目前這個 Bot Worker **沒有提供網站寫入 API**。因此，尚未部署另外的身分驗證與授權後端前，網站的雲端上傳／刪除會失敗並保留待同步狀態。這是明確的安全遷移界線，不能宣稱正式網站寫入已全部遷移完成。原有載入時自動合併 main 資料也已停用，防止未授權背景寫入。

Bot 的正式寫入全由已驗證 LINE 簽章的後端執行，再以群組 allowlist、signed user ID、核准綁定與角色檢查授權。報名 primary key 是 `(match_id,user_id)`；較舊的 timestamp 不覆蓋較新狀態。相同毫秒的第二個不同更新會要求重試，避免不可判斷的事件先後造成覆蓋。選擇流程有 actor、group、版本與期限。

生產憑證只用環境 secrets。`.env`、`.dev.vars`、`.wrangler`、`.local` 均忽略。`.env.example`、`bot/.dev.vars.example` 為空值／佔位說明。群組訊息不顯示 LINE User ID；資料庫內 identity 與稽核只供授權管理。沒有自動列舉全群成員，也不收集普通群組聊天內容。

事件 ID 去重保存 30 日；未知回覆送達狀态保留 `send_unknown`，不再次使用 replyToken，以免洗版。資料操作可能已成功但訊息回覆失敗，隊員可重新查看名單。Webhook 未完成資料操作時的 500 必須查稽核／事件狀態再處理，不應盲目重播已處理事件。

## 正式部署：需要擁有者設定，尚未執行

1. 建立 LINE 官方帳號，啟用 Messaging API，取得 Channel Secret 與 Channel Access Token；準備 Cloudflare 帳號、D1 及 HTTPS Worker 網域。
2. 在 LINE Developers 的 Messaging API 設定啟用 **Allow bot to join group chats**。該開關預設關閉；同一群組同時只能有一個官方帳號。開啟 Webhook，關閉預設自動回覆／歡迎訊息避免重複。
3. 由擁有者執行 `npx wrangler d1 create tk-aero-line-bot`，將回傳 database ID 填入 `bot/wrangler.jsonc`。初始化：`npx wrangler d1 execute tk-aero-line-bot --remote --config bot/wrangler.jsonc --file bot/schema.sql`。這是正式資料庫寫入，必須由擁有者確認後操作。
4. 用 `npx wrangler secret put LINE_CHANNEL_SECRET --config bot/wrangler.jsonc`、`... LINE_CHANNEL_ACCESS_TOKEN ...` 隱藏輸入，不提交憑證。設定 `BOT_OWNER_USER_IDS` 為可信隊長 ID；自身 ID 可在 LINE Developers channel Basic settings 取得。Bot 角色是本系統授權，不是假設能讀取 LINE 群組管理員。
5. 保持 `ENABLE_PUSH=false`、`ALLOW_PUBLIC_STATS=false` 先部署驗證。部署命令：`npx wrangler deploy --config bot/wrangler.jsonc`；Webhook URL 為 `https://你的Worker網域/webhook`。LINE Verify 的空 events 回傳 200，簽章錯誤回傳 401。
6. 加官方帳號好友，再邀請它加入**一般群組**。已簽章的 group event 會把 Group ID 記錄在 `bot_discovery`；allowlist 尚未設定時不回覆。擁有者可唯讀查詢 D1 `SELECT group_id,first_seen FROM bot_discovery`，只核准自己的球隊群組到 `ALLOWED_GROUP_IDS`，不要用聊天室文字猜 ID。
7. 經球隊同意公開數據後設 `ALLOW_PUBLIC_STATS=true`，隊長先申請／核准綁定，再在群組輸入「選單」完成實機驗收。所有功能在此同一群組操作。
8. 真實群組驗收完成且擁有者同意推播後，設定官方帳號方案與額度，再將 `ENABLE_PUSH=true`；隊長在個別賽程開啟提醒。Bot 每 5 分鐘處理賽前 24 小時／1 小時提醒，過期 1 小時的工作不補發。

正式原排棒模型需要足夠 Worker CPU；設定 `cpu_ms=30000`，需支援此限制的付費 Workers 方案。不可為免費 10ms 限制改用不一致簡化模型；上線前以正式資料量量測 CPU 與 reply 時限。參考 [Cloudflare CPU 限制](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)。

預設每群每分鐘最多 12 次回覆、每人 1500ms 冷卻。推播先查官方 quota/consumption 與群組人數，再保守扣除每月 200 人次、每天 5 次操作的本機上限。所有上限可設定；本機預算不能替代官方 quota。失敗保守保留預留額度，不自動退款。提醒最多 3 次嘗試，保留同一 UUID retry key；官方 409 + accepted request ID 視為已受理。`budget-blocked` 不自動補發，需擁有者檢查原因。

若由團隊之外的人加入同一群組，已公開的 Flex 內容亦可能被看到；核准群組及成員分享範圍必須在啟用前處理。頭像僅接受正式來源的 HTTPS 圖片，舊網站內嵌 data URI 頭像顯示姓名卡片替代；請提供公開 HTTPS 圖片後再驗證 LINE 載入。

## Rollback

- 原始基準：`origin/main` 的 `40f2c23cf086c7af2e4fc0ee222d6fe7b8ae6633`；新分支 `codex/line-group-bot-v1`。移除前端憑證後的安全 checkpoint 是 `checkpoint-line-safe-baseline-v1`（`60d51aa`），回退 Bot 請優先使用此版本。舊 OpenChat 工作另存 `codex/openchat-team-v1` 的 `3d3f50e`，不在此交付中。
- 未部署：切回需要的原分支即可；不要丟棄目前未提交的其他工作。
- 已部署：先 `ENABLE_PUSH=false`，停用個別比賽提醒或 Webhook，匯出 D1 備份，再回退到已驗證安全 Worker 版本；保留綁定、報名資料表與稽核，不自動刪除。
- 不可把含舊 Token 的 index 重新公開。若要撤回 Bot 功能，保留前端移除憑證的安全修改；Token 必須仍保持撤銷。不要重寫 Git 歷史，也不要直接修改 main。
- 正式部署、D1 初始化、真實群組訊息與實機 Flex 圖形驗收尚待擁有者操作；本機測試通過不代表 LINE 實機已通過。

官方參考：[群組功能](https://developers.line.biz/en/docs/messaging-api/group-chats/)、[簽章驗證](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[Flex Message](https://developers.line.biz/en/docs/messaging-api/using-flex-messages/)、[官方 Node SDK](https://line.github.io/line-bot-sdk-nodejs/)、[安全重試](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)。
