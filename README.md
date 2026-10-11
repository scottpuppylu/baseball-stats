# 淡江航太系壘 數據中心

球隊的成績、場記與分析網站：<https://scottpuppylu.github.io/baseball-stats/>

網站是一個靜態頁面（GitHub Pages），不需要建置；正式統計仍讀取 GitHub `data` 分支的 JSON。已移除前端 GitHub 憑證與直接授權寫入；雲端上傳需要另行部署安全後端，本機保存與唯讀分析保留。

LINE 一般群組圖形化 Bot 的可執行程式、群組操作流程、憑證設定、安全遷移與 rollback，見 [Bot 說明](bot/README.md)。本機測試結果見 [驗證紀錄](bot/VERIFICATION.md)。

## 頁面

全隊總覽、球員檔案、排行榜、雙人比較、生涯紀錄、數據分析、投手分析（數據）；打線安排、比賽場記（比賽）；指標說明（參考）。比賽場記含實況記分、歷史賽事覆盤與落點噴流圖。

## 資料存放

| 檔案 | 內容 |
| --- | --- |
| `data/logs.json` | 打擊日誌（手動補登、選手建檔，與由場記自動產生的每場成績） |
| `data/games.json` | 場記賽事（逐局、逐打席、守備事件） |
| `data/avatars.json` | 球員頭像 |
| `data/tags.json` | 球員標籤（綽號） |
| `data/defense.json` | 各守位的能力順位（排棒依據） |
| `data/guests.json` | 支援／外援選手名冊（第一次登記支援選手時建立） |

- 這些檔案存在 **`data` 分支**（2026/10/11 起）。`main` 分支只放網站程式，所以網站上新增或修改資料不會產生 `main` 的 commit，也不會重新部署網站。
- `main` 分支裡的 `data/` 是搬遷當時的版本，只作為讀取失敗時的最後備援。載入時的舊版 main 自動合併已停用，避免未授權背景寫入。
- 原網站的版本比對與多裝置合併邏輯保留，但正式上傳必須接上受控 `/api/documents/...` 後端；此 Bot Worker 不提供網站寫入服務。
- 總覽頁的「⬇ 完整備份」可把目前全部資料下載成一個 JSON 檔。

## 程式結構

| 檔案 | 作用 |
| --- | --- |
| `index.html` | 頁面與主要程式（資料讀寫、計算、各頁繪製、場記） |
| `team-insights.js` | 逐場成績與近況、出賽率、賽後成績圖與 MVP |
| `team-records.js` | 生涯紀錄頁與個人生涯紀錄 |
| `lineup-model.js`、`lineup-recommender.js` | 計時賽棒次模型與推薦 |
| `player-diagnostics.js` | 打擊弱點診斷 3.0 |
| `ui-comfort.js`、`ui-comfort.css` | 版面與手機操作（導覽、表格摺疊、段落跳轉） |

各模組透過 `index.html` 的 `siteHooks` 登記要在哪個繪製函式之後執行（`siteHooks.list()` 可看完整順序）。

## 測試

需要 Node.js 與已安裝的 Google Chrome：

```bash
npm install
npm test
```

測試使用 `tests/fixtures/data/` 的固定資料與隔離預覽伺服器（`tests/ui-preview-server.cjs`），所有 GitHub 讀寫都導向記憶體，不會修改正式資料。每次推送到 `main` 時，GitHub Actions 也會自動執行（`.github/workflows/test.yml`）。各項修正與驗收紀錄見 [`docs/UI_QA.md`](docs/UI_QA.md)，功能清單見 [`docs/UI_FUNCTIONAL_BASELINE.md`](docs/UI_FUNCTIONAL_BASELINE.md)。
