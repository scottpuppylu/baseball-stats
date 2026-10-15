# 淡江航太系壘 數據中心

正式網站：<https://scottpuppylu.github.io/baseball-stats/>

同一套 HTML/CSS/JavaScript 支援 Windows 瀏覽器、Android PWA 與 iPhone PWA。免登入、免註冊、免輸入 Token，直接操作原有十頁、場記、打線與資料同步；使用者電腦不需常開。網站由 GitHub Pages 託管，資料仍存在 GitHub `data` 分支，沒有額外後端、OAuth 或帳號名單。

[PWA 安裝與使用](docs/PWA_GUIDE.md) · [發布驗收](docs/PWA_RELEASE_REPORT.md) · [部署與回滾](docs/PWA_ROLLBACK.md)

## 功能與資料

全隊總覽、球員檔案、排行榜、雙人比較、生涯紀錄、戰力分析、投手分析、智慧排棒、比賽場記與指標說明。保留 10/11 棒、DH、計時賽、JSON/CSV 匯出、頭像裁切及所有原統計公式與資料格式。

`data/logs.json`、`games.json`、`avatars.json`、`tags.json`、`defense.json`、`guests.json` 的 GitHub 分支與 Schema 不變。讀寫使用既有 GitHub Contents API；上傳先讀最新 SHA，再做三方合併，409 重新讀取與重試。失敗不會回報同步成功，應保留本機資料及備份後重試。正式站的「完整備份」可下載 JSON。

PWA 只快取必要靜態檔與移除憑證的離線 HTML，不快取 GitHub/API/資料回應。離線資料可能過期，雲端寫入暫停；連線恢復後按提示重新整理數據。新版本由使用者同意後啟用，進行中的場記仍由本機儲存恢復。

## 既有風險接受

**RISK_ACCEPTED，並非 SECURITY_PASS。** Product Owner 於 2026/10/16 明確選擇保留正式站現有 Token 直接讀寫模式，接受公開憑證可還原及濫用的風險。Token 值與權限不變，未輪替或撤銷；沒有把它增加到其他程式、文件、APK 或 PWA 快取。原本的字元陣列不是安全保護。GitHub 安全保護若拒絕推送／發布，必須停止，不能略過或關閉。

## 開發與驗證

網站直接由根目錄發布，不需 build。開發測試需要 Node.js 22+ 與 Google Chrome：

```bash
npm ci
npm test
npm run test:pwa
node scripts/pwa-release-audit.cjs
node scripts/rollback-pwa.cjs --check
```

測試預覽將原憑證先移除並代換為無效測試值，所有 GitHub 請求轉到 fixtures 的記憶體模型；不會對正式 data 測試寫入。CI 只有 `.github/workflows/test.yml`，使用同一套測試，不需要 repository secret。

原生 Android、Capacitor、APK/Gradle、Android CI、Release 簽章、Google OAuth、Cloud API 已取消。舊建置產物即使仍在本機，也只屬被忽略的歷史測試檔，不會進入正式程式或建置。接手成果保留於 checkpoint `8ec27b6`（tag `codex/checkpoint-phase6-before-pwa-only-20261016`）及歷史驗收文件。
