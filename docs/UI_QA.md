# 響應式 UI 改版驗收

日期：2026-10-04。功能基準：`903cf977`，詳見 [完整功能清單](UI_FUNCTIONAL_BASELINE.md)。

## 完成的改版

- 手機：四個常用功能的底部導覽與所有九頁的展開選單；日期篩選可收合，並顯示目前範圍。
- 平板：完整上方導覽，控制列可換行；場記球場與操作盤可並列。
- 桌機：固定側邊導覽與較寬的工作區；一致的卡片、字級、表格及焦點提示。
- 全隊統計：新增重點／傳統／紀律與擊球／進階／全部五種欄位組合。僅改顯示，不刪除數據；全部模式仍有 23 欄。
- 表格：完整欄位可捲動、第一欄固定、溢出時提示左右滑動；鍵盤可聚焦捲動區。
- 手機個人頁：縮小身份區，核心指標排在大型雷達／圓餅圖之前；所有圖表與指標仍可閱讀。
- SVG 落點可點選開啟詳情；Chart.js 原有操作保留。
- 彈窗依可視高度限制，內容可捲動；操作訊息置於底部導覽上方，訊息多時可捲動。
- 恢復瀏覽器頁面縮放；加大觸控控制，保留安全區及減少動畫偏好。

## 功能保留證據

`index.html` 原有業務 script 逐字未變（比對時只正規化 CRLF），原有 inline 操作綁定的內容及順序未變，282 個原有靜態與模板 DOM 識別也全部保留。新增 UI 位於 `ui-comfort.css` 與 `ui-comfort.js`；UI 層不直接讀寫持久資料，也不呼叫網路 API。新增導覽仍觸發原本按鈕的操作。

完整業務 script 的 SHA-256 基準：
`6fb7e6ffe46cd4c480889a2a0d88025f0f32810dd4226a31b5b5ad157f5832a8`

這是「本次 UI 改版沒有改動既有業務邏輯或移除原有入口」的證據，不表示既有版本所有邊界情況都已被修正。

## 已通過的檢查

| 檢查 | 結果與範圍 |
| --- | --- |
| 自動測試 | 35 項通過：原有 30 項同步回饋測試，加上 5 項完整程式／操作綁定／介面識別與 UI 層檢查。 |
| 響應式主頁 | 7 種尺寸 × 9 個主頁＝63 組通過；整頁沒有水平溢出，操作控制未被非捲動容器裁切。 |
| 尺寸 | 320×568、390×844、844×390、768×1024、1024×768、1440×900、1920×1080。 |
| 場記與覆盤 | 手機、平板、桌機 3 條流程，共 42 項流程檢查通過。 |
| 瀏覽器錯誤 | 上述新建隔離測試頁面沒有 JavaScript pageerror。 |
| 正式資料保護 | GitHub 讀寫被導向本機記憶體模擬；響應式檢查對正式 GitHub 的請求數為 0。測試不修改 data/*.json。 |

42 項流程檢查包含：推薦套用自訂打線、先攻／後攻、10／11 棒、開賽、BB、跑者出局保持打者、替補、球場落點與 HR／RBI／得分、半局同步、旋轉保留完整比賽狀態、僅換投、換投同時替換棒次、防守事件、完賽同步、覆盤保存失敗後重試、落點觸控詳情。

其他檢查包含：全部 23 欄仍可顯示、日期收合後保留數值、旋轉保留日期、選單 Escape 關閉、守位彈窗落在可視範圍內。

## 重現方式

在專案目錄執行（Node.js 與 Playwright 可由目前 Codex runtime 提供）：

```powershell
node --test tests/sync-feedback.test.cjs tests/ui-integrity.test.cjs
node tests/ui-preview-server.cjs
```

預覽伺服器預設 `http://127.0.0.1:54321`，只綁本機；測試頁會標示隔離模式，移除實際 credential，模擬雲端寫入到記憶體，重新啟動即重置。

在另一個 PowerShell 開啟獨立瀏覽器並取得 CDP 位址：

```powershell
npx --yes agent-browser --session baseball-ui open about:blank
npx --yes agent-browser --session baseball-ui get cdp-url
```

依工具回傳的實際位址設定 `UI_CDP_URL`，再執行：

```powershell
$env:NODE_PATH = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$env:UI_CDP_URL = '工具回傳的 CDP 位址'
node tests/ui-responsive.cjs
node tests/ui-workflows.cjs
```

預設截圖及 JSON 報告在 `%TEMP%\baseball-ui-qa`；可用 `UI_QA_OUTPUT` 指定其他輸出目錄，`UI_PREVIEW_PORT`／`UI_PREVIEW_URL` 指定其他本機埠。

## 實測界線

已驗證 Chromium 中的手機、平板及桌機尺寸與觸控模擬；尚未用實體 iPhone Safari、Android 裝置或各型平板驗證。原版已存在、而且本次未改動的資料及操作邊界，列在功能清單第 7 節；這次不把它們宣稱為已修正。正式 GitHub 寫入以先前同步修正與本次模擬測試為基礎，本次 UI QA 不透過正式寫入驗證。

## 手機頭像後續調整

手機個人頁頭像由 72px 放大為 144px，身份區改為置中排列；相機圖示移到照片外側，並移除觸控時會覆蓋人像的 hover 遮罩。桌機維持原有布局。

`tests/ui-avatar.cjs` 在 320、390、430px 手機寬度及 1440px 桌機寬度的四組檢查通過：頭像大小、手機相機與照片不重疊、頁面不溢出、相機仍開啟原有檔案選擇器，以及檢查過程不寫入資料。五項功能完整性測試亦通過。
