# Phase 6 接手與發布驗收 — 2026/10/16（Asia/Taipei）

> **歷史紀錄／發布判定已作廢。** 2026/10/16 PWA Only 最終指令取消原生 Android 與 OAuth/Cloud API，既有 Token 風險改列 RISK_ACCEPTED。下文保留作歷史證據，不是現行設定教學或 Release Gate。現行驗收以 [PWA_RELEASE_REPORT.md](PWA_RELEASE_REPORT.md) 為準。

**TASK STATUS：BLOCKED。** 已完成接手查核、原站唯讀 Smoke Test、原有回歸、新增啟動競速測試、Android Debug 建置與三次全新資料驗收。未 Commit、Push、建立 PR、Merge 或部署；正式站與 data 分支保持原狀。所有測試通過的範圍不等同於已滿足產品發布條件。

## A. 實際 Git 狀態

- 起始工作樹乾淨；目前有本次測試與文件修改，尚未提交。
- 分支：`feature/mobile-app-pwa-android`；HEAD：`26fc05e5c63cc7de7783456b850802fd6b800aee`。
- 遠端 main：`40f2c23cf086c7af2e4fc0ee222d6fe7b8ae6633`。
- 遠端 data：`8fdffb297731316bbcf8b6a908033b8d6985ff38`。
- 遠端尚無本開發分支。已執行 fetch、ls-remote，未改動遠端。當地另一 checkout 的 `data` 分支較舊，判斷正式資料以遠端為準。
- 證據：[git-audit.json](phase6-evidence/git-audit.json)。

## B–D. Token、架構與正式讀寫

實際正式站：<https://scottpuppylu.github.io/baseball-stats/>。Pages API 確認是 legacy branch deployment，來源 `main:/`。公開 HTML 與 origin/main 僅 BOM 有差異，去除首尾空白後相同。

原站 `origin/main:index.html` 的第 2468 行以整數字元陣列建立 Token，再 `String.fromCharCode` 還原。這是可還原的公開憑證，不是加密保護。本報告不收錄值、陣列、值的雜湊或任何可還原副本。

原站流程：

1. `fetchGitHubContent()` 對 `https://api.github.com/repos/scottpuppylu/baseball-stats/contents/<path>?ref=data` 發送帶 Bearer 的 GET，取得內容與 blob SHA；大檔使用 raw media type。
2. `commitJsonFile()` 寫入前重新讀取最新 SHA；比較載入時基準、本機、雲端，三方合併後 PUT 同一路徑，body 包含 `branch: data`、message、Base64 JSON、替換版本 SHA。Base64 是 Contents API 的資料傳輸格式，不是憑證保護。
3. 409 重新讀取與合併，最多三次；失敗保留本機副本並回報失敗。
4. 原站還保留舊 main 資料遷移機制；本分支停用了它，未擅自重新啟用可能寫入正式資料的路徑。

本次用原有 Token 僅做 GET：repository 與 data 目錄均回 200，repository 回報 push/admin 權限。Token 未更換、撤銷或變更權限。最近 data commit 為 `8fdffb2`（2026/10/12），歷史可證實資料曾成功寫入；本次未做正式 PUT，**不能將「有效憑證＋寫入權限」宣稱為本次正式端到端寫入成功**。證據：[production-audit.json](phase6-evidence/production-audit.json)。

開發版衝突：`cloud-sync.js` 只透過配置的 API 寫入；`app-config.js` 的 apiBase 是空字串，因此寫入明確失敗。Google OAuth 沒有強迫訪客登入才能讀取，但在原型中是 API 寫入的必要條件。Android 打包同一份轉接器，也有同樣阻礙。這是前任留下的未完成整合，不能部署來取代可寫入的舊站。

**本次沒有新增或部署任何外部服務，沒有恢復公開嵌入 Token，沒有實作裝置輸入 Token，也沒有要求任何隊員登入／註冊／設定白名單。** `cloud-api/` 原始碼保留為未採用原型；不把完成其部署當作使用者的必要待辦。

## E. Android Debug APK

- `npm run build:android` 成功，APK 8,515,294 bytes；簽章驗證為 `CN=Android Debug`，versionName `1.0.0-debug`，不是 Release。
- `adb install -r` 成功；Android 16 / API 36 `sdk_gphone64_x86_64` 模擬器。
- `npm run test:android-cold`：每次只清空模擬器中本 App 的測試儲存，三次各 10 組均通過。腳本拒絕清空實體手機。
- 每次涵蓋：本機打包啟動、十頁、返回鍵先關閉對話框再回上一頁、旋轉／背景／殺程序後場記恢復、鍵盤、寫入不可用時不誤報同步、CSV 分享、JSON 分享、系統圖片挑選器、離線提示／重新連線。
- 補驗最終腳本 11/11 通過：系統圖片挑選器開啟；以真實 PNG 經 WebView file input → 解碼 → 裁切／旋轉／重置 → 本機保存，並確認雲端未啟用時仍回報上傳失敗。檔案由自動化選入，系統挑選器中實際點選相片的手動流程及正式上傳 **NOT_TESTED**。既有 ui-avatar 另外驗證四種視窗下的頭像顯示與挑選入口。
- 原生 GitHub 成功寫入 **BLOCKED**；此處驗證的是未配置 API 時正確失敗。跨裝置寫入與 409 在隔離記憶體 GitHub 中驗證，沒有對正式 data PUT。
- 實體 Android 手機、其他 OS 版本與正式 Release 簽章 **NOT_TESTED**；本機沒有既有 `android/keystore.properties`，未建立 Release。
- 證據：[android-build.log](phase6-evidence/android-build.log)、[android-cold-start.json](phase6-evidence/android-cold-start.json)、[fresh-1](phase6-evidence/android-fresh-1.log)、[fresh-2](phase6-evidence/android-fresh-2.log)、[fresh-3](phase6-evidence/android-fresh-3.log)。
- 最終補驗：[android-final.json](phase6-evidence/android-final.json)、[android-final.log](phase6-evidence/android-final.log)、[圖片裁切截圖](phase6-evidence/android-photo-crop.png)、[JSON 原生分享截圖](phase6-evidence/android-json-share.png)。

### 首次啟動追查

找到前任原始操作紀錄：最終 APK 首次測試命令使用 `2>&1 | tail -1 | cut -c1-300`，只留下錯誤結尾 `}`，且管線未保留測試 exit code；該次根因無法從保留資料還原。更早的一次有 WebView 連接階段 websocket 斷線堆疊，不能直接推定和最後一次相同。證據：[handoff-startup-investigation.json](phase6-evidence/handoff-startup-investigation.json)。

另外用延遲隔離資料的測試，獨立重現舊 readiness 條件不足：模組 1,678ms 就緒時 games=0、同步仍 pending；4,360ms 才完成資料載入。已補上資料／原生版本就緒等待、完整失敗 JSON、逐項 checkpoint、初始 launch 的錯誤捕捉與資源清理、避免鍵盤驗收靜默略過、測試寫入攔截，以及每次全新資料獨立紀錄。

**資料 readiness 競速已重現與修正於驗收腳本，但不是原始首次失敗的確診。** 三次全新資料測試通過，也不能據此把原始問題以偶發結案。Gate-05 因此保守標記 BLOCKED。後續需在可捕捉早期 WebView/原生錯誤的實體手機與首次安裝環境驗收；如再現，使用完整錯誤與 logcat 對照定位，而非只增加等待或重試掩蓋斷線。證據：[startup-result.json](phase6-evidence/startup-result.json)、[startup-test.log](phase6-evidence/startup-test.log)。

## F–G. PWA 與棒球功能回歸

- 原有 `npm test`：142/142 單元測試、16/16 瀏覽器測試組通過；新增 ui-startup 另跑通過。參見 [regression.log](phase6-evidence/regression.log)。
- PWA manifest、SW 安裝與接管、離線啟動、離線不誤報上傳、重連、更新提示／使用者同意後換版、舊 cache 移除、停用 SW 的 kill switch 均通過。PWA 不快取 data、API、登入或 GitHub 回應。
- 實體 Android Chrome／iPhone 的作業系統安裝流程 **NOT_TESTED**；瀏覽器中的 SW 安裝成功不等於實機「加入主畫面」已驗收。
- 原有十頁、即時場記、進行中賽事恢復、打線推薦／10–11 人與 DH、球員／投手統計、賽事覆盤、生涯紀錄、JSON／CSV、頭像、63 組 responsive layout、跨裝置三方合併／刪除／409 競速通過原有隔離測試。
- 正式站 Chrome 唯讀 Smoke Test：390px／1440px 各十頁，共 20 檢查，均正常；59 筆日誌、4 場賽事，沒有 script exception 或全頁橫向溢出，沒有任何寫入嘗試。所有非 GET/HEAD 均在瀏覽器層阻擋。證據：[production-smoke.json](phase6-evidence/production-smoke.json)。

## H. 安全與資料完整性

本次只變更測試及文件，沒有改動 runtime 業務邏輯。相對原 main，`lineup-model.js`、`lineup-recommender.js`、`player-diagnostics.js`、`team-insights.js`、`team-records.js` 及 `data/` 沒有差異；inline 業務程式、事件處理器、DOM ID 仍通過交接 baseline。正式資料 Schema 未變。

APK 全部 476 個解壓 entry 掃描未發現原 Token 的 literal、UTF-16、原字元陣列形式或常見 Token／私鑰樣式，證據：[apk-scan.json](phase6-evidence/apk-scan.json)。這是產物檢查的 PASS，**不表示正式站的既有公開憑證風險已解決**。沒有新增或提交金鑰。

另外比對 APK 與目前原始碼：24 個 runtime 來源內容一致（app-config.js 只有 LF/CRLF 差異）；這次文件與測試腳本不打包進 APK。證據：[apk-source-parity.json](phase6-evidence/apk-source-parity.json)。

測試寫入只送隔離記憶體 GitHub。遠端 main/data 前後 SHA 不變，工作樹 data 無異動；沒有正式資料修復或回填操作。

## I. RELEASE GATES

| Gate | 狀態 | 證據／原因 |
| --- | --- | --- |
| 01 原有主要功能回歸 | PASS | regression.log：142 單元＋16 瀏覽器組；production-smoke.json：正式站 20 個唯讀頁面檢查 |
| 02 正式讀寫機制可用、無未部署依賴 | FAIL | app-config apiBase 空；cloud-sync writeFile 拒絕寫入；本分支若發布會失去既有匿名寫入 |
| 03 憑證安全 | FAIL | APK 掃描通過且本次未擴大暴露；但正式站公開 Token 仍有效，依最新指示不能宣稱安全 Gate 通過 |
| 04 公式與資料格式未變 | PASS | git-audit.json、inline baseline 及原有模型／資料測試 |
| 05 Android／PWA 必要驗收 | BLOCKED | 自動化通過，Android 全新資料 3/3；前任最終首次失敗原始錯誤被截斷，尚無確診；實體裝置流程未驗收 |
| 06 main/data 無非預期異動 | PASS | git-audit.json：遠端 SHA 前後不變、data 工作樹無修改 |
| 07 無已知資料遺失問題 | BLOCKED | 合併／失敗恢復隔離測試通過；公開有效 Token 仍可繞過前端直接破壞資料，尚無可接受的匿名寫入保護方案 |
| 08 必要 GitHub CI | BLOCKED | 本分支未推送、沒有本次 commit 的 CI；舊 main CI 成功不能替代本次驗收 |
| 09 可驗證的網站回滾 | BLOCKED | 已準備步驟與憑證檢查；目前舊站 baseline 含公開 Token，尚無「完整可寫入＋不重新散布憑證」的安全回滾版本；未演練正式切換 |

## J–L. Git Push、PR、CI、Merge 與 Pages

沒有執行 Commit／Push／PR／Merge／正式部署。這是發布 Gate 阻擋，不是缺少一般 Git 操作授權。正式站維持 main@40f2c23，Pages 仍為既有來源。本次沒有新部署 commit 或本分支 CI URL。

## M. APK 路徑與 SHA-256

- `C:\Users\User\baseball-stats-mobile\android\app\build\outputs\apk\debug\app-debug.apk`
- SHA-256：`719bc60af6be6b0f4bfe1aa6b8a1e8bfe4753246ee729184db2851453e4a7c95`
- Debug 簽章，僅供測試，不對外大規模發布。當前 APK 的雲端寫入受阻，不是完整產品發布版本。

## N. 最小替代架構與未完成項目

GitHub Pages 是靜態託管，無法私藏執行 GitHub 寫入授權所需的秘密。GitHub Contents API 寫入需要憑證；若匿名裝置持有可直接寫入的共享 Token，就能提取它。參見 [GitHub Pages 定義](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Contents API 授權與 SHA 規定](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28)。

**最小候選方案（只有提案，沒有實作、開通或切換）：**

```text
網站 / PWA / Android → 一個匿名 HTTPS 寫入 Worker → GitHub data 分支
        └──────────── 公開讀取仍直接走 GitHub ────────────┘
```

保留 Pages、GitHub、JSON Schema、原統計與 SHA 合併；一個 Cloudflare Worker 只承接六個允許的資料檔寫入，Token 由擁有者存於 Worker secret，裝置與公開程式碼均不帶 Token；不需要 Google／GitHub 登入、editor/admin 名單或隊員額外設定，也不需要電腦常開。這是對現有 cloud-api 轉接介面的最小改造方向，無需改用另一套資料庫。

截至本次查詢，Workers Free 為每日 100,000 requests、每次 10ms CPU；Secret 可在服務端以加密 binding 保存。免費額度與大份 JSON 的 CPU 預算需要在實際負載驗證，不能保證永遠零費用／零維護。平台代管伺服器，仍需要擁有者一次性開通、設定 secret／部署，以及程式更新與故障處理。來源：[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

提案的保護限於固定 repo/data/六個路徑、大小與既有資料形狀驗證、SHA compare-and-swap、限流、無秘密 Log、錯誤保留本機，以及 Git 歷史可恢復。CORS／Origin 不是身份驗證；不能把它們或公開 App 內的另一把 key 當作授權。完全匿名仍無法區分合法使用者與惡意訪客的合法格式刪改，需明確接受此產品取捨或改變寫入政策。

**更關鍵的限制：既有 Token 已公開且保持有效，即使搬進 Worker secret，外部仍能用公開歷史的 Token 繞過 Worker。** 這個候選方案只避免新 APK／產物繼續散布憑證，不能修復舊外洩。若要求安全 Gate 真正通過，必須另行允許處理外洩憑證或撤除它對正式資料的寫入能力；目前「不撤銷、不換值、不改權限」限制下做不到。本次完全未執行任何憑證處置。

其餘未完成：正式匿名寫入架構決策與驗證、原始首次啟動問題確診、實體 Android／iOS PWA 安裝與圖片實際選取、合法 Release 簽章、遠端 CI、符合安全要求的回滾版本、正式發布。回滾步驟見 [PHASE6_ROLLBACK.md](PHASE6_ROLLBACK.md)。

## O. 最終狀態

**BLOCKED。** 保留全部仍有效的前任工作，交付可安裝的 Debug APK 與可追溯測試結果。沒有為了發布而降低零門檻、功能、資料或安全要求，沒有擅自切換正式架構。
