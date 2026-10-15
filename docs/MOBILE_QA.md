# 手機 App 化驗收紀錄（2026/10/13）

> **歷史紀錄／發布判定已作廢。** 2026/10/16 PWA Only 最終指令取消原生 Android 與 OAuth/Cloud API，既有 Token 風險改列 RISK_ACCEPTED。下文保留作歷史證據，不是現行設定教學或 Release Gate。現行驗收以 [PWA_RELEASE_REPORT.md](PWA_RELEASE_REPORT.md) 為準。

> 歷史紀錄：其中撤銷 Token、Vercel、OAuth／白名單的待辦已被 2026/10/16 產品需求取代，不能作為要求使用者設定的依據。Phase 6 的實際結果與發布阻礙見 [PHASE6_REPORT.md](PHASE6_REPORT.md)。

分支 `feature/mobile-app-pwa-android`，起點 `main@40f2c23`。所有測試都在隔離環境：固定 fixtures、記憶體中的 GitHub、真實 API 程式碼搭配測試用設定；正式 `data` 分支（`8fdffb2`）與 `main`（`40f2c23`）在整個過程中未被修改。

## 環境

| 項目 | 版本 |
| --- | --- |
| OS | Windows 11 Pro 10.0.26300 |
| Node.js / npm | 24.14.1 / 11.11.0（CI 用 22） |
| Capacitor | core / cli / android 8.5.3；app 8.1.2、browser 8.0.5、filesystem 8.1.4、share 8.0.3、splash-screen 8.0.2、network 8.0.1 |
| JDK | Microsoft OpenJDK 21.0.12.1 |
| Android SDK | platform 36、build-tools 36.0.0、platform-tools 37.0.1、emulator 37.2.12 |
| 模擬器 | `sdk_gphone64_x86_64`，Android 16（API 36），WebView Chrome 133 |
| 瀏覽器測試 | Playwright 1.62.1 + Google Chrome |

## 結果

| 測試 | 起點（未修改） | 本分支 |
| --- | --- | --- |
| `npm test` 單元測試 | 106/106 | 142/142 |
| `npm test` 瀏覽器測試 | 15/15 | 16/16（新增 `ui-pwa`） |
| `tests/android-device.cjs`（模擬器） | — | 9/9 項通過；最終 APK 連跑 3 次，2 次通過、1 次（剛安裝後第一次）失敗訊息被截斷未能確認原因，記為可能的啟動時序不穩 |
| Debug APK 建置 | — | 通過：`app-debug.apk` 8,515,294 bytes，SHA-256 `c1935252833c8fb61c9e31caf9518f39da0bed6d86ac07b3515a968a2c8a400f`；解壓掃描無憑證樣式 |
| Release AAB/APK 設定（未簽章，僅驗證設定，產物已刪除） | — | 通過 |

### 新增的自動化測試

- `tests/cloud-api.test.cjs`（14）：未登入/竄改/過期/他人簽章 session 一律 401；editor 不能改 defense（403）；移出名單立即失效；只寫 `data` 分支六個檔案；路徑竄改 404；分支設定被改成 main 時拒絕；資料形狀與 `__proto__` 驗證；sha 過期或缺少 → 409 且不覆蓋；GitHub 失敗 → 502、例外不外洩細節、「成功但沒有新版本」也視為失敗；未設定 → 503；CORS 不等於權限；Google 登入完整流程（issuer、audience、nonce、Email 驗證、名單、偽造 state、攔截代碼無 verifier 不能兌換）。
- `tests/cloud-sync.test.cjs`（10）：前端不含憑證；未設定 API、未登入、離線時寫入明確失敗且不送出請求；401 清除 session；網路失敗與逾時回報失敗；一次性登入代碼與 verifier。
- `tests/pwa.test.cjs`（7）：manifest、圖示尺寸、`/baseball-stats/` 子路徑、頁面無遠端 script、SW 快取清單與頁面一致、SW 不處理資料/API/登入/GitHub、更新需使用者同意、所有出貨檔案無憑證樣式。
- `tests/android-project.test.cjs`（5）：App ID、`webDir`、無 `server.url`（非遠端網址殼）、只有網路權限、`allowBackup=false`、登入返回連結、SDK 版本、簽章只讀取被忽略的本機檔、Git 未追蹤任何金鑰/local.properties/產物、`www/` 不含資料與伺服器程式。
- `tests/ui-pwa.cjs`（瀏覽器）：manifest 與圖示可讀、SW 安裝與接管、快取內沒有資料/API/登入回應、離線開啟與提示、離線上傳回報失敗、恢復連線提示、部署新版後出現更新列並切換到新版、舊快取刪除、kill switch。
- `tests/android-device.cjs`（模擬器）：packaged-app、ten-pages、back-dialog-then-page、rotation-background-restart、keyboard、no-fake-sync、csv-share、photo-picker、offline-notice。

### 原有測試的調整（皆因寫入路徑改變，未刪除任何檢查）

| 檔案 | 原因 |
| --- | --- |
| `tests/ui-integrity.test.cjs` | 基準 v6：只有 inline script 雜湊改變（移除 Token、讀寫改經 `cloudApi`、停用需要憑證的 legacy 合併、離線讀取錯誤）。事件處理器與 278 個 DOM id 雜湊不變。 |
| `tests/ui-preview-server.cjs` | 預覽改跑真實 `cloud-api` 程式；資料請求仍以 `/__mock-api/data/<檔名>` 傳遞，原有的失敗/競速模擬照常作用。 |
| `tests/sync-feedback.test.cjs` | 以 `cloudApi` 替身轉到原本的假雲端，合併與 409 重試測試內容不變。 |
| `tests/ui-audit-fixes-2.cjs` | 其自訂攔截器多處理 API 格式（JSON 而非 base64）；新檔案「不帶 sha」改為 `sha: null`。 |
| `tests/ui-round3.cjs` #17 | 原測「舊頁寫入 main 會被合併」；合併已完成並停用，改測：只經 API 寫入 `data`、commit 標示操作者、未登入不會寫入、載入頁面不寫任何資料。 |
| `tests/ui-insights.cjs` | 失敗訊息附上狀態列文字（診斷用）。 |

### 介面與行為（沒有改動統計與業務邏輯）

- AVG/OBP/SLG/OPS/wRC+、打線模型、10/11 棒與 DH、計時賽、跑者/換投/換局、生涯紀錄、封存標記、`data` 分支 JSON 格式：**全部未修改**（`lineup-model`、`player-diagnostics`、`spray-archive`、`ui-lineup`、`ui-records`、`ui-review-fixes` 等測試照舊通過）。
- 新增：頁首 🔐 登入鈕（手機/平板只顯示圖示）、離線/恢復/更新/安裝提示列、iOS 主畫面設定、安全區留白。
- 發現並修正：安全區規則一度覆寫桌面側邊欄的 `body` 左內距（改放在 `html`）；Android WebView 不會更新 `navigator.onLine`（改用 Network 外掛）；首次安裝 SW 時不應重新載入頁面。
- 已知：鍵盤開啟時底部導覽列仍顯示在鍵盤上方（不遮擋輸入欄位，已實測）；錯誤提示中部分既有文字仍寫「GitHub」（屬於既有業務程式字串，未改動）。

## Pending（需要人或外部帳號）

| 項目 | 狀態 |
| --- | --- |
| 撤銷舊 GitHub Token | **待擁有者執行**（見 `MOBILE_APP.md` §5） |
| Vercel 部署、Google OAuth、細粒度 Token、環境變數 | 待擁有者設定；在此之前正式站寫入為「未啟用」 |
| 以真實 Google 帳號登入與正式寫入 | 未測（不可使用假憑證宣稱可用） |
| iPhone 實機 PWA 安裝與登入返回 | 未測（無 iOS 裝置） |
| Android 實體手機 | 未測（僅模擬器 Android 16） |
| 正式簽章 Release APK/AAB | 未建立（需擁有者金鑰） |
| GitHub Actions `android.yml` 首次執行 | 尚未推送，未在 CI 上跑過 |
