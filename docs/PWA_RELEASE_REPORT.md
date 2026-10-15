# PWA Only 發布驗收基線 — 2026/10/16

本文件記錄可重跑的程式與本機驗收；Commit／PR／CI／Pages 是提交後產生的證據，最終 TASK REPORT 與本機 `outputs/pwa-release/` 另記錄其精確結果，不把本機測試當成已部署成功。

## 範圍與 checkpoint

分支沿用 `feature/mobile-app-pwa-android` 名稱，產品已改為網站／Android PWA／iPhone PWA／Windows 瀏覽器。接手 HEAD 為 `26fc05e`，上次未提交成果先保存成 checkpoint `8ec27b6`，本機 tag 為 `codex/checkpoint-phase6-before-pwa-only-20261016`。

原生 Android 工程、Capacitor、APK／Gradle scripts、Android CI、Release 簽署流程及 Google OAuth／Cloud API 原型已從正式分支移除。只剩 Playwright 開發測試依賴，npm audit 回報 0 vulnerabilities。舊本機建置快取受到忽略，不會進入正式產品。歷史驗收與 checkpoint 保留，前次原生首次啟動問題已退出本次產品及發布 Gate。

## 讀寫與資料完整性

直接重用原 main@40f2c23 的 inline 業務及 GitHub Contents API 程式。`fetchGitHubContent()`、`commitJsonFile()`、三方合併、SHA／409 重試、失敗回報與本機恢復維持原流程；增加離線／無憑證離線頁的寫入保護，並修正原站賽事 ID 只取時間末四位造成的碰撞風險。新 ID 保持 game_日期_識別碼 的字串形式，改用 128 位隨機識別碼；舊資料與舊 ID 不轉換。不需登入、註冊、輸入 Token、申請授權或新後端。

`scripts/pwa-release-audit.cjs` 驗證：除上述三行離線保護與一行 ID 產生修正，inline 業務程式與原 main 完全相同；五個統計／推薦模組及 data 檔沒有差異。Token 宣告逐字相同，沒有額外檔案副本，值與權限未變。證據：[release-audit.json](pwa-evidence/release-audit.json)。

正式 data 基線：`8fdffb297731316bbcf8b6a908033b8d6985ff38`。所有寫入測試只使用 fixture／記憶體 GitHub，未做正式 PUT，**不宣稱完成正式端到端寫入驗收**。發布後的正式 Smoke Test 阻擋所有非 GET/HEAD。

## 安全風險接受

**RISK_ACCEPTED，並非 SECURITY_PASS。** Product Owner 明確接受既有公開 Token 可被還原及濫用的風險，保留其值／權限，不輪替、不撤銷。字元陣列與 Base64 不是秘密保護。這項既有風險依最新指令不單獨阻擋 PWA 發布；新安全缺陷、資料遺失、讀寫失效及 CI 失敗仍會阻擋。

沒有新增秘密或額外公開 Token 檔。離線 HTML 在寫入 CacheStorage 前完整移除 Token 宣告值，若辨識不到預期格式則拒絕快取。GitHub／API／data 不進 SW 快取；線上頁面保持原來的憑證模式。測試預覽先移除真憑證才傳給瀏覽器，測試失敗輸出另做遮蔽，避免新增 Log 暴露。GitHub 安全保護若拒絕推送或發布，停止操作，不 bypass 或關閉保護。

## 自動化結果

- `npm test`：**115/115 單元、18/18 瀏覽器測試組通過**（ID 修正前的完整本機回歸）。原生 Android／OAuth/API 測試隨已取消的產品移除；原 main 的棒球及直接同步測試恢復，沒有略過原有功能檢查。[完整紀錄](pwa-evidence/local-tests.log)
- PWA：manifest／隊徽、Chrome 安裝條件、`/baseball-stats/` 子路徑、SW 安裝接管、靜態快取、離線啟動／提示／不誤報同步、重連後直接寫入、更新同意、新版啟用、舊 cache 清除、進行中場記恢復、停用開關均通過。[PWA 結果](pwa-evidence/pwa-result.json)
- 真實 PNG 經 file input、解碼／裁切／旋轉／重置後，使用原直接寫入程式成功存入隔離 GitHub。JSON／CSV 由原回歸測試驗證。
- 十頁、10/11 棒與 DH、計時賽、球員／投手統計、生涯紀錄、場記及恢復、跨裝置合併／刪除／409、頭像入口、63 組 responsive layout 等回歸通過。
- PWA 停用回滾：本站 Worker／cache 清除、localStorage 場記保留、十頁及直接 fixture 寫入通過。[回滾結果](pwa-evidence/rollback-result.json)
- 修正測試基礎設施的受限埠問題：系統曾分配 2049，Fetch 明確回報 bad port；現改用探測過的高連接埠。沒有以重試略過失敗案例。

新增 ID 碰撞回歸：固定時鐘及十秒差的 200 次建立，舊程式僅產生 1 個 ID，修正後為 200 個。最終補驗 **116/116 單元**、PWA／回滾／資料安全三組瀏覽器均通過，兩個裝置的新賽事在三方合併後均保留。[補驗紀錄](pwa-evidence/id-fix-local-tests.log)

第一輪遠端 CI 第一個預覽服務未就緒，其他檢查通過；因原 runner 丟棄啟動 stderr，不能確診該次原因。已改用綁定後的 IPC 就緒握手、保留啟動錯誤與 HTTP 狀態、並避開常見客戶端暫用埠範圍，未略過測試。最新提交仍須重新通過完整遠端 CI 才能合併。

## Release Gates

| AC | 本機／程式驗收 | 證據 |
| --- | --- | --- |
| 01 單元 | PASS | id-fix-local-tests.log，116/116 |
| 02 瀏覽器回歸 | PASS | local-tests.log，18/18 |
| 03 PWA 安裝條件／離線／更新 | PASS（自動化範圍） | pwa-result.json；實機另列 UNVERIFIED |
| 04 電腦／手機十頁 | PASS | responsive、records、workflow 等回歸 |
| 05 GitHub 直接讀取 | PASS | 原 Contents API 與隔離／正式唯讀查核；部署後再次比對 |
| 06 直接寫入、無 API 依賴 | PASS（fixture） | PWA、同步單元及跨裝置測試；正式 PUT 未測 |
| 07 離線／失敗提示與保存 | PASS | PWA、sync-feedback、data-safety |
| 08 三方合併／SHA | PASS | sync-feedback、data-safety、round3 |
| 09 公式／Schema 不變 | PASS | release-audit.json、完整回歸 |
| 10 main/data 無非預期修改 | PASS（發布前） | release-audit.json；部署後再核對 data |
| 11 原生 Android 退出 | PASS | 套件、scripts、工程與 CI 移除檢查 |
| 12 SW／快取更新 | PASS | pwa-result.json |
| 13 回滾準備 | PASS | rollback-result.json、rollback-pwa --check |
| 14 正式 Pages 與 Smoke Test | 提交／CI／合併後驗證 | 精確 commit、Actions、Pages 與正式唯讀結果記於最終 TASK REPORT |

上述表格不是 CI 或正式部署成功的預先宣告。必須等目標提交的 GitHub Actions 成功，才合併 main；若失敗，只在開發分支修復。

## 實機邊界與操作文件

實體 Android Chrome、iPhone Safari 的主畫面安裝、Standalone、系統 Splash／分享流程：**UNVERIFIED**。Chrome 的技術安裝條件與 manifest／iOS meta／安全區檢查不等於實機驗收。本次沒有使用 Android 模擬器充當實體手機。

使用方式見 [PWA_GUIDE.md](PWA_GUIDE.md)，部署／回滾見 [PWA_ROLLBACK.md](PWA_ROLLBACK.md)。正式寫入測試、實機操作均未冒充通過；它們的未驗證狀態依最新驗收規則明確列出。
