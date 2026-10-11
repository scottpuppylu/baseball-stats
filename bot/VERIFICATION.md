# LINE 群組 Bot V1 本機驗證紀錄

驗證環境：Windows、Node.js 24.14.1、Google Chrome／Playwright、TypeScript 5.9.3、官方 LINE SDK 11.3.0、Wrangler 4.149.0。日期：2026-10-12（Asia/Taipei）。新分支 `codex/line-group-bot-v1`；沒有推送、正式部署或真實群組發送。

| 執行項目 | 結果與範圍 |
| --- | --- |
| `npm test` | 原網站 106/106 單元測試與 15/15 瀏覽器測試組通過；包含場記、排行、MVP、排棒、手機及平板版面。所有雲端寫入被隔離 preview 截取 |
| `npm run bot:test` | 21/21 通過；包含官方 SDK 原生 payload、簽章、Postback、雙人比較、綁定核准、群組建立賽程、報名、多使用者、去重、截止、角色、跨群組、隱私、限流、提醒重試、來源失敗及持久化／交易 rollback |
| `npm run bot:consistency` | 原網站瀏覽器獨立基準：16 位球員所有聚合數值、最近五場、生涯里程碑／連續場次、4 場戰報與 MVP 相同；10/11 棒含鎖棒的完整模型輸出一致。最大浮點差 `5.293955920339377e-23`，容忍 `1e-12` |
| `npm run bot:worker-smoke` | 真正本機 workerd + Cloudflare D1：正式 Worker health／空 webhook 驗證、簽章偽造拒絕、原生 Flex 主選單、兩名隊員同時報名、事件重送只算一次均通過。獨立測試入口的 transport 不呼叫 LINE |
| `npm run bot:build` | 正式 Worker dry-run bundle 成功，未部署到遠端 |
| `npm run bot:replay` | 12 份功能 Flex payload 產生於 `.local/line-flex/`；完整數據／排行／比較／報名／10/11 棒教練確認／戰報流程成功 |
| `npm run bot:mock` | Loopback HTTP 模擬器實際啟動；`/health` 及「選單」回傳 native Flex 成功；SQLite 持久化另有重啟單元驗證 |
| 正式公開資料唯讀測試 | `https://raw.githubusercontent.com/scottpuppylu/baseball-stats/data/data` 五份 JSON 可讀；原引擎得到 16 位球員、4 場完賽、最低 PA24；沒有寫入 |
| `npm audit --json` | 0 已知 dependency vulnerability；不是對所有安全問題的保證 |
| 現有檔案敏感模式掃描 | 82 份 tracked/source/Bot 程式與說明檔，未找到 GitHub token／private-key 模式。未掃描或改寫 Git 歷史；舊 Token 是否撤銷仍未知 |
| 正式資料隔離 | 比對 `data/*.json` 前後 SHA256 無變更；瀏覽器一致性測試的載入寫入次數為 0。群組流程測試使用 frozen fixtures，沒有真實通知 |

可查看機器可讀本機報告：`.local/line-consistency.json`、`.local/line-worker-smoke.json`、`.local/line-public-source.json`、`.local/line-security-scan.json`。舊網站瀏覽器截圖與報告位於 `C:\Users\User\AppData\Local\Temp\baseball-ui-qa`。這些執行產物不提交至 Git。

測試曾發現並修正：本機 workerd 不支援未來 compatibility date、JSONC 格式化後的測試正規式、關閉再啟用提醒的 outbox 恢復，以及官方 409 retry-key 已受理回應。最終測試使用已修正版本。

## 仍未驗證的正式範圍

- 沒有 Channel Secret、Access Token、Cloudflare D1 ID／部署授權，因此尚未加入真實 LINE 群組、驗證手機實際 Flex 外觀／Quick Reply 行為、官方 payload validation、真實群組權限與實機提醒。
- 真實部署 CPU、正式 LINE 回覆時限、官方帳號額度與 HTTPS 頭像載入須在上線前驗收。
- 前端已移除舊 GitHub 憑證，但擁有者仍須撤銷 Token、處理仍在線的舊頁、檢查歷史曝光與異常操作。
- 原網站唯讀／本機功能通過回歸；雲端上傳與刪除因安全遷移需另行授權後端，不能宣稱正式寫入仍正常。
