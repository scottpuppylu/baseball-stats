# Apple PWA 支援與實機驗收

## 支援目標（不是逐 OS 實機 PASS）

| 系統 | 網站／安裝方式 | 本次驗證邊界 |
| --- | --- | --- |
| iOS／iPadOS 15.0–15.3 | Safari 網站、分享→加入主畫面；vh 備援、傳統 hasOwnProperty | 目標相容，原生日期、下載、鍵盤與儲存須實機確認 |
| iOS／iPadOS 15.4–16 | 同上；支援時使用 dvh | 目標相容，未逐 OS 實測 |
| iOS／iPadOS 17 | 同上；可使用新版 Storage API，但不依賴它 | 未實機驗收 |
| iOS／iPadOS 18 | 同上 | 未實機驗收 |
| iOS／iPadOS 26 及更新 | 同上；依系統提供的 Web App 選項 | 不對尚未測試版本保證完整支援 |
| macOS 14+／Safari 17+ | Safari 網站、檔案→加入 Dock | Dock 安裝、獨立視窗與儲存須實機確認 |
| 較舊 Apple 系統 | 優先一般網站，依瀏覽器能力漸進增強 | 不承諾完整 PWA；不提供歷史 OS 全通過宣稱 |

Apple 主畫面設定參考 [Apple Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)；Dock Web App 自 Sonoma／Safari 17 提供，見 [WebKit Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)。[WebKit 儲存政策](https://webkit.org/blog/14403/updates-to-storage-policy/)說明儲存額度與系統回收；本機保存不等於雲端備份。

## 自動化範圍

`npm run test:apple` 使用 Playwright WebKit。六種視窗涵蓋手機直／橫、平板直／橫、507px 分割畫面、Mac 視窗，共 60 個頁面檢查。另測原始場記與重新開啟恢復、日期、JSON／CSV 下載、圖片解碼／裁切／旋轉、直接 GitHub fixture 成功／失敗、本機儲存隔離、離線提示與重連、Worker 在伺服器 503 時的完整快取回復。

Windows Playwright WebKit 的 `setOffline(true)` 後導覽，在只有 `respondWith(new Response(...))` 的獨立最小 Worker 也會發生 internal error。因此報告獨立記錄 `offlineNavigationProbe`；此環境不能證明真正 Safari 的斷網重新開啟。Chromium 的真實斷網重新開啟另有通過測試。Linux CI 會記錄自己的 probe 結果。這不是 Apple 實機 PASS，也不是把 503 測試等同飛航模式。

不同 BrowserContext 的儲存隔離是自動化模型；Safari 與 Home Screen／Dock 的實際資料分區仍須實機測。沒有使用 UA／視窗模擬冒充實體 iPhone／iPad。

## 人工驗收清單（全部 UNVERIFIED，請使用隔離測試預覽進行寫入）

在 iPhone、iPad、Mac 各記錄 OS／Safari 版本、日期及結果，安裝與首次開啟需要網路。正式網址僅做唯讀驗收；場記／上傳／衝突／同步寫入使用 `node tests/ui-preview-server.cjs` 的隔離資料，不對正式 data 寫測試。

- [ ] Safari 分享→加入主畫面／Mac 檔案→加入 Dock；名稱「航太系壘」、隊徽正確，獨立視窗啟動。
- [ ] 瀏海／Dynamic Island／Home Indicator 不遮按鈕；直橫切換、鍵盤開關及 iPad Split View 皆可操作。
- [ ] 十頁導覽、表格捲動、打線選單、球員統計、日期與彈窗可用；觸控可命中。
- [ ] 隔離預覽記一個打席，背景／關閉再開原視窗，場記完整恢復。
- [ ] 照片選取、裁切、旋轉、取消／確認；下載 CSV／JSON 並從 Files／下載項目開啟，確認 JSON 含 activeGame。
- [ ] 比較 Safari 與安裝版本機場記；不假定自動共用，確認已同步資料能讀回。
- [ ] 飛航模式重開已快取版本；出現離線提示，未同步操作保留；恢復連線後能重試。
- [ ] 隔離環境兩裝置編輯、SHA 409 重試、同步失敗後重試，無資料覆蓋遺失。
- [ ] V1 安裝後只改 JS／CSS 發布 V2；前景看到更新提示，可稍後；場記中禁止立即更新。
- [ ] 完成／儲存、關閉其他編輯分頁後同意更新，V2 生效、舊程式快取清除，紀錄／備份存在。

目前沒有連接實體 Apple 裝置；iPhone／iPad／Mac 三者一律 **UNVERIFIED**。自動化可通過並發布，但不得對外宣稱 Apple 全平台已驗收。
