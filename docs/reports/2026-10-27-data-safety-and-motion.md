# 航太系壘網站：資料保存問題複查 ＋ 動畫流暢度優化 — 實作交接報告

- 對象：負責實作的工程代理（6.1 sol 高）
- 檢查版本：正式站 `v261026.1214`，commit `a8e0d41`（repo `scottpuppylu/baseball-stats`，GitHub Pages 由 `main` 發布）
- 檢查日期：2026/10/27
- 範圍：複查另一份審查報告列出的問題；提出修法；另外量測並提出動畫流暢度優化方案
- 本次只讀與在**隔離預覽**中重現，未修改任何程式、未寫入正式資料、未動 `data` 分支

---

## 0. 結論總表

| # | 問題 | 判定 | 證據 | 優先 |
|---|---|---|---|---|
| D1 | 同步失敗後重新整理，覆盤修改被雲端舊資料覆蓋 | **存在（已重現）** | 預覽：比分改 12:8、上傳失敗 → 重新整理後變回 0:0 | P0 |
| D1b | GitHub API 失敗時，備援副本優先於本機快取（新發現，已更正範圍） | **存在（範圍較小）** | 載入順序為 API → raw.githubusercontent（data 分支）→ 網站 `./data/`，最後才用本機快取；API 失敗但 raw 可用時（例如流量限制），雲端副本仍覆蓋本機未同步修改。正式 PWA **不快取 `data/`**（`sw.js:70`），完全離線時會落到本機快取 | P0（併入 D1） |
| D2 | 完賽上傳期間仍可登打，期間新增的打席遺失 | **存在（已重現）** | 預覽：上傳中按鈕可用，期間共 3 打席，存檔只剩 1 筆，進行中比賽被清除 | P0 |
| D3 | 本機儲存失敗仍回報成功，重開即遺失 | **存在（已重現）** | 預覽：`localCache.set()` 回傳 `true`、localStorage 副本被刪、IndexedDB 寫入失敗，重開後資料回到舊版 | P0 |
| D4 | 覆盤新增打席自動灌入固定落點 `x=0.2, y=0.35` | **存在（程式確認）** | `index.html:10506-10507`；改守位只改 `location`，座標不變 | P1 |
| S1 | 正式站含可還原的 GitHub 寫入 Token | **存在；已記錄為接受風險** | `index.html:2476` 字元陣列；README「RISK_ACCEPTED，並非 SECURITY_PASS」 | 由產品負責人決定 |
| S2 | Bot 依賴 undici 有高風險公告 | **存在** | `discord/` 執行期 `undici@6.29.0`（經 discord.js）落在 GHSA-xjj6-f33q-929c 影響範圍 `>=6.23.0 <6.29.1`；`npm audit --omit=dev` 回報 1 項 high；根目錄 `undici@7.29.1` 只經 `wrangler`（開發工具） | Bot 恢復前必修 |
| B1–B5 | Bot 功能問題（方向規則、Discord 排序、去重、LINE 路由、成績圖快取） | **未獨立重驗** | Bot 目前停用；本報告未逐項重現，列入 Bot 恢復前檢查清單 | P2 |
| R1 | `renderAll()` 重繪所有頁（含隱藏頁與圖表） | **部分確認** | `renderAll` 每次重建總覽／球員／排行／分析圖表／對決／打線，只有場記與投手會跳過隱藏頁；單次 75–85 ms（未降速）、約 400 ms（CPU 降速 4 倍）。「重繪 5 次」經原審查者說明是量測時主動連續呼叫 5 次，並非自動發生；預覽中啟動只 1 次、換球員 0 次 | P1（與動畫優化一起做） |
| R2 | 每次換頁都重新渲染該頁、重建圖表（新發現） | **存在** | `switchMainTab` 每次都重跑該頁 render；分析頁第二次進入時 `quadrantChartInst.id` 21→24（圖表被銷毀重建） | P1 |

> 建議順序：D1＋D1b → D2 → D3 → D4 → R1/R2＋動畫優化 A 組 → 動畫 B/C 組 → Bot。

---

## 1. 專案規則（實作時必須遵守）

- 完成並測試後直接 commit 到 `main` 並 `git push origin main`，不開分支、不開 PR。
- 每次推送前重新蓋版本章：`index.html` 頂部徽章 `vYYMMDD.HHMM`（台北時間，用 Node `Intl` 計算），並在 `changelog.js` 最上方新增**同版本號**的中文條目（`tests/changelog.test.cjs` 會檢查）。
- **不得修改 `data` 分支**（球隊正式紀錄）。任何資料清理（例如 D4 的舊座標）必須先列清單給產品負責人確認。
- 平板只用側邊抽屜（☰），不出現手機底部分頁列。
- 「完成」= 跑過測試並實測：`node tests/run-all.cjs`（單元測試＋28 組瀏覽器測試）。隔離預覽：`UI_PREVIEW_PORT=<port> node tests/ui-preview-server.cjs`（啟動時建置，改檔後要重啟）。預覽提供 `window.__previewFailWrites = true` 模擬寫入失敗。
- CI 已知偶發：`ui-scorebook-lineup` 在 GitHub runner 上偶爾等不到按鈕「stable」，重跑即過；本機穩定。

---

## 2. 資料保存問題：根因與修法

### D1　同步失敗後重新整理會丟失修改

**重現（隔離預覽）**
1. 改 `allGames[0].finalScore = {us:12, opp:8}`，寫入本機快取，設 `__previewFailWrites = true` 後呼叫 `commitGamesToGitHub()` → 回傳 `false`，畫面提示「已保留本機紀錄」。
2. 重新整理 → 比分變回 `0:0`。

**根因**
- `loadDatabaseSource()`（`index.html:2567` 起）只要雲端讀取成功，就 `apply(content)` 並 `localCache.set(storageKey, ...)`，直接用雲端內容覆蓋本機；沒有任何「尚未同步的本機修改」紀錄。
- 失敗訊息（例如 `index.html:9588`、`9615`、`9826`、`9906`）都說「已保留本機」，但只保留到下次載入為止。
- 健康資料已有正確做法：`player-health-store.js` 的 `rebas_player_health_pending` 草稿，成功才清除。

**修法：賽事與日誌的「待同步草稿」**
1. 新增 `sync-drafts.js`（或擴充 `local-cache.js`），持久化結構：
   ```js
   // key: 'rebas_sync_pending'
   { games: { [id]: {op: 'put', value: <完整 record>, at: <ms>} | {op: 'delete', at} },
     logs:  { [id]: {...同上} } }
   ```
   - 必須寫入 IndexedDB（失敗才退回 localStorage），且確認寫入完成（見 D3）。
2. 所有會改 `allGames` / `allLogs` 並準備上傳的地方（覆盤儲存、每局上傳、完賽、登入日誌、撤銷、放棄賽事、日誌編輯），**在呼叫 commit 前**把受影響的 id 寫入草稿。
3. `commitJsonFile()` 成功後，只清除「這次成功送出、且送出後未再被修改」的 id（比較 `at` 或內容雜湊），避免清掉上傳期間又改的資料。
4. `loadDatabaseSource()` 套用雲端內容後，**把草稿覆蓋回去**（草稿優先），再寫入本機快取，並顯示常駐提示「有 N 筆修改尚未同步」＋「重新同步」按鈕（重送合併後資料）。
5. 合併以 id 為鍵：賽事 `g => g.id`、日誌 `l => l.id`（與 `commitJsonFile` 現有 keyOf 相同）。刪除用墓碑（`op:'delete'`）避免被雲端資料「復活」。
6. PWA 更新阻擋（`pwa.js` 的 `updateBlockReason`）應把「有草稿」視為不可更新的狀態。

**驗收測試（新增 `tests/ui-sync-drafts.cjs`）**
- 失敗上傳 → 重新整理 → 修改仍在、提示顯示 1 筆；`__previewFailWrites=false` 後按重新同步 → 雲端有新值、草稿清空。
- 上傳進行中再修改同一場 → 成功回應後草稿仍保留第二次修改。
- 刪除（放棄賽事）失敗 → 重新整理 → 該賽事不會被雲端資料復活。

### D1b　API 失敗時備援副本優先於本機快取（新發現，範圍已更正）

**更正**：正式 PWA 的 service worker 明確不快取 `data/`（`sw.js:70`），完全離線時 `fetchLocalContent()` 兩個來源都會失敗，最後會使用本機快取。先前在隔離預覽中「離線重開讀到舊資料」，是因為預覽伺服器會回應 `./data/*.json`，不代表正式站離線行為。

**仍存在的風險**：`loadDatabaseSource()` 在 GitHub API 失敗後，先試 `fetchLocalContent()`：第一個來源是 `raw.githubusercontent.com` 的 `data` 分支，其次是網站 `./data/`，**成功就直接採用並覆蓋本機快取**。API 失敗但 raw 可用（流量限制、Token 失效、API 暫時錯誤）時，本機尚未同步的修改仍會被雲端副本蓋掉。

**修法**：併入 D1。套用任何來源（API、raw、靜態）之後都要再覆蓋 D1 草稿；另外調整順序為「API → 本機快取（若存在）→ raw／靜態」，或在採用備援副本時保留本機快取中較新的紀錄。狀態列標示目前資料來源（雲端／備援副本／本機）。

### D2　完賽上傳期間仍可登打，新紀錄遺失

**重現（隔離預覽）**：開賽、記 1 個保送 → 讓 PUT 延遲 1.5 秒 → 呼叫 `finishActiveGameAndSyncLogs()` → 300 ms 後保送按鈕仍可見可按，再記 2 個保送（進行中比賽共 3 打席）→ 上傳完成後存檔只有 1 打席，`activeGame` 已被清除。

**根因**（`index.html:9591` 起）：
- `finishedGame = JSON.parse(JSON.stringify(activeGame))` 在兩次 `await`（games、logs 上傳）**之前**取快照；
- 上傳期間 UI 未鎖定；
- 成功後 `activeGame = null` 並移除 `rebas_active_game`，期間新增的打席只存在於被丟棄的 `activeGame`。
- 附帶：失敗路徑會把 `activeGame.status` 改回 `in_progress`，但 `allGames` 本機已放入 `status:'finished'` 的快照且已執行 `syncAllGamesToTeamLogs()`，本機日誌會短暫包含未完賽資料（重試成功會覆蓋，但仍應一併修正）。

**修法**
1. 進入完賽流程時設 `window.__gameFinalizing = true`，並把即時記分區設為 `inert`（`document.getElementById('scoreSubPanelLive').inert = true`），一次封鎖所有點擊與鍵盤操作；顯示覆蓋層「完賽資料上傳中…」。
2. 所有會修改進行中比賽的函式（`recordQuickWalk`、`recordDefenseEvent`、各種 record/undo、換局、換人、DH 切換、編輯打線）開頭加守門：`if (window.__gameFinalizing) { showToast('完賽上傳中，請稍候'); return; }`（防程式或鍵盤繞過 inert）。
3. 防重複送出：完賽按鈕在流程中 `disabled`。
4. 成功時再保險一次：比較 `JSON.stringify(activeGame)` 與快照（排除 `status`），若不同代表有新內容 → 不清除進行中比賽，提示「完賽後仍有新紀錄，請再按一次完賽」。
5. 失敗時：解除 `inert`、`__gameFinalizing=false`，把 `allGames` 內該場改回 `in_progress` 版本（或從 `allGames` 移除完賽快照、只保留進行中比賽），並寫入 D1 草稿；提供「重試完賽」。
6. 所有路徑用 `try/finally` 確保解除鎖定。

**驗收測試**：延遲 PUT 期間嘗試點保送 → 不可點、打席數不變；成功後存檔打席數 = 完賽前；PUT 失敗 → 可繼續記錄、重試成功後所有打席都在。

### D3　本機儲存失敗仍回報成功

**重現（隔離預覽）**：讓 `localStorage.setItem('rebas_all_games')` 拋出 QuotaExceededError、`IDBObjectStore.prototype.put` 拋錯 → `localCache.set()` 回傳 `true`，`rebas_cache_idb_only` 被設為 `1`、localStorage 副本被刪；離線重開後資料回到舊版。

**根因**（`local-cache.js`）：
- `set()` 對大型 key 一律 `return true`；
- `mirror()` 在 localStorage 放不下時，**在確認 IndexedDB 寫入成功之前**就切換 IDB-only 並刪除所有 localStorage 副本；
- `flush()` 的交易錯誤只 `console.warn`，佇列已清空，不重試、不通知。

**修法**
1. 兩階段：先寫 IndexedDB，`tx.oncomplete` 後才刪 localStorage 副本、才設 `rebas_cache_idb_only`。
2. `flush()` 失敗時把寫入放回佇列（保留最新值），指數退避重試；連續失敗時發出 `window.dispatchEvent(new CustomEvent('localcache:error', {detail}))`。
3. 新增 API：`localCache.whenPersisted(key)` 回傳 Promise（寫入完成 resolve、失敗 reject）、`localCache.status()`（`{pending, failed, lastError}`）。完賽、覆盤儲存等關鍵流程要 `await` 它；失敗時顯示常駐警告「本機儲存空間不足，資料尚未保存」＋「下載完整備份」按鈕（站內已有完整備份功能）。
4. 啟動時呼叫 `navigator.storage.persist?.()` 降低被系統清除的機率；`navigator.storage.estimate()` 用量超過 80% 時提醒。
5. `set()` 回傳值改為「是否已同步寫入至少一個持久層」；只寫在記憶體時回傳 `false`。

**驗收測試**：上述模擬下 → 警告出現、`status().failed === true`；恢復 put 後自動重試成功、警告消失；離線重開資料為新值。

### D4　覆盤新增打席灌入固定落點

**根因**：`addPlayToReviewInning()`（`index.html:10495` 起）推入 `x: 0.2, y: 0.35, location: 'LF'`；`applyReviewFormToGame()` 只更新 `p.location`（`index.html:10595`），座標不變。噴流圖只要 `x/y !== undefined` 就畫點。

**修法**
1. 新增打席**不寫 `x`、`y` 欄位**（不要寫 `null`，現有判斷 `pa.x !== undefined` 會把 `null` 當成有座標畫在角落）。
2. 所有畫點判斷改為 `Number.isFinite(pa.x) && Number.isFinite(pa.y)`（`index.html:5977、6090、6894、10137、10677`）。
3. 覆盤編輯提供「在球場圖點選實際落點」才寫入座標；只改守位時清除該筆的推估座標（若座標正好等於舊預設 0.2/0.35）。
4. 既有資料：座標等於 `0.2／0.35` **只能當作「可能是預設值」的候選清單，不能據此判定為假落點**（實際點選也可能落在附近）。本次不修改任何既有資料；若要清理，需另外提供每筆的賽事、局數、打者、守位與建立方式（例如是否由覆盤新增）給產品負責人逐筆確認，經同意後才另案處理 `data` 分支。9/19、9/20 封存規則維持。

**驗收測試**：新增打席後噴流圖點數不變；改守位為 RF 不產生左側點；在圖上點選落點後才出現點。

---

## 3. 安全與 Bot

### S1　GitHub 寫入 Token
- 現況：`index.html:2476` 以字元陣列存放，可被任何訪客還原；README 記載產品負責人 2026/10/16 接受風險（RISK_ACCEPTED）。
- **不在本次實作範圍**，除非產品負責人改變決定。若要處理，建議：
  1. 短期：改用 fine-grained token，只授權此 repo 的 Contents（理想是只允許 `data` 分支），並輪替現有 token。
  2. 長期：小型代理（repo 已有 `wrangler`，可用 Cloudflare Worker）持有 token，網站以球隊通行碼換短效憑證；Worker 驗證 JSON schema 與大小後才寫入。
- 禁止：把 token 加到其他檔案、文件、APK、PWA 快取；GitHub 安全保護若拒絕推送不得繞過。

### S2　undici 安全公告（GHSA-xjj6-f33q-929c，high，2026/10/23）
- `discord/`：`discord.js@14.27.0 → undici@6.29.0`（執行期，**受影響**，修補版 6.29.1）。修法：升級 discord.js 至帶 undici ≥6.29.1 的版本，或在 `discord/package.json` 加 `"overrides": {"undici": "6.29.1"}`，重新安裝後跑 Bot 測試。`npm audit --omit=dev` 另列出同套件的 EventSource 記憶體 DoS，一併確認已修。
- 根目錄：`wrangler → miniflare → undici@7.29.1`（開發工具，受影響範圍 `<7.30.1`）。升級 wrangler 即可，非正式網站漏洞。

### B1–B5　Bot 功能（未獨立重驗，Bot 恢復前檢查）
| 項目 | 原報告描述 | 建議處理 |
|---|---|---|
| B1 統計引擎落後網站 | 同一筆左打左側球，網站判「推打」、Bot 判「拉打」 | Bot 改為直接載入網站同一份統計程式／方向規則，加對照測試（同資料同結果） |
| B2 Discord 歷史排序 | 32 場同對手只列最舊 25 場 | 確認 `engine.games()` 排序方向；`tactics.ts` 第 108 行 `games.slice(-25)` 需依實際順序取最新 25 場並分頁 |
| B3 分享去重 | 已送出但成功通知失敗，重試重複發送 | 送出前寫入冪等鍵（訊息 id／內容雜湊），重試先查 |
| B4 LINE 投手守備入口 | 路由忽略詳細頁參數，一律回成績圖 | 修路由參數解析並加路由測試 |
| B5 成績圖快取 | 檔案不存在仍回 `cached:true` | 命中前檢查檔案存在與大小，缺檔則重新產圖 |

---

## 4. 重繪與換頁效能（R1、R2）

**現況**
- `renderAll()`（`index.html:8055`）由 26 處呼叫（資料載入、篩選、同步完成…），每次重建所有頁面與 4 張分析圖表、打線推薦，只跳過隱藏的場記／投手。單次 75–85 ms（未降速），CPU 降速 4 倍約 400 ms。
- `switchMainTab()`（`index.html:3275` 起）每次進入頁面都重跑該頁全部 render；分析頁第二次進入時圖表被銷毀重建（`quadrantChartInst.id` 21→24）。

**修法：資料版本＋髒標記**
```js
let dataVersion = 0;             // 資料或篩選改變時 +1
const renderedAt = {};           // tabId -> 上次渲染時的 dataVersion
function renderAll() { dataVersion++; renderPage(currentTab); }      // 只畫目前頁
function renderPage(tab) { if (renderedAt[tab] === dataVersion) return; /* 原本的分頁 render */ renderedAt[tab] = dataVersion; }
// switchMainTab：顯示面板後呼叫 renderPage(tabId)
```
- 「資料或篩選改變」包含：日期篩選、簡承均開關、雲端載入完成、本機快取補水、任何 commit 成功後資料變動、選擇球員（只影響球員頁時只標記球員頁）。
- `siteHooks.after('renderAll')` 的模組（ui-app、team-insights、team-records、player-health…）要確認仍在正確時機更新；建議新增 `siteHooks.after('renderPage', …)`。
- 圖表重用：已存在的 Chart 實例改用 `chart.data = …; chart.update('none')`，不要 `destroy()` 再 `new Chart()`。

---

## 5. 動畫流暢度：量測與優化方案

### 5.1　量測方法與結果
- 環境：Chrome（有真實 GPU 的有頭模式）、手機視窗 390×844（DPR 3）、**CPU 降速 4 倍**、隔離預覽、目前正式版程式。以 `requestAnimationFrame` 記錄每格時間；「long」= 超過 25 ms 的格數。
- 注意：這是電腦模擬，不等於 iPhone 13／S21 實機；實作完成後應以實機 Safari Web Inspector／Chrome remote debugging 複驗。

| 情境 | 現況（最差一格） | 主要原因 |
|---|---|---|
| 總覽頁捲動 | p95 6–11 ms，最差 39–45 ms，2 格 long | 玻璃 backdrop＋SVG 折射濾鏡、`body` 固定背景、全站 text-shadow 疊加 |
| 換頁 → 分析 | **單格 739–872 ms** | 換頁時重建 4 張圖表；Chart.js 初始化讀尺寸觸發整頁強制排版（約佔 45%）；排版後再執行表格整理 |
| 換頁 → 紀錄 | **單格 556–705 ms** | 大頁面首次排版（`scrollTo` 觸發的強制排版佔大半） |
| 開「更多」抽屜 | p95 17–67 ms，4 格 long | 抽屜滑入時 SVG 位移濾鏡（折射）每格重算 |
| 開工具面板 | 第一格 120–190 ms | 首次建立大面積模糊與折射圖 |

**A/B 測試（關閉單一效果後）**
| 變體 | 捲動最差 | 分析換頁 | 紀錄換頁 | 抽屜 p95 |
|---|---|---|---|---|
| 現況 | 39–45 ms | 739–872 ms | 556–705 ms | 17–67 ms |
| 觸控裝置改用一般模糊（不用 SVG 折射） | 22 ms | 不變 | 不變 | **11 ms** |
| 關閉 `body` 固定背景 | 28 ms | 不變 | 不變 | 11 ms |
| 關閉 text-shadow | 22 ms | 不變 | 不變 | 11 ms |
| 非首段區塊 `content-visibility:auto` | **22 ms** | **611 ms（−17%）** | **422 ms（−24%）** | 11 ms |

結論：**換頁凍結是最大的卡頓來源，與玻璃無關，要靠減少換頁時的工作量解決**；玻璃效果主要影響捲動與抽屜，可在觸控裝置上降級而外觀差異很小。

### 5.2　優化方案（依效益排序）

**A 組：換頁不卡（效益最大）**
1. **A1 髒標記渲染**（第 4 節）：資料沒變就不重繪；回到看過的頁面幾乎零成本。
2. **A2 圖表重用與固定尺寸**：Chart 實例重用＋`update('none')`；圖表容器用 CSS 固定高度或 `aspect-ratio`，並設 `maintainAspectRatio:false`，避免 Chart.js `getMaximumSize()` 讀取尺寸時強制整頁排版。
3. **A3 分段渲染**：換頁時先顯示面板與文字（第一格就能開始淡入），圖表與次要區塊用 `await scheduler.yield()`（不支援時 `setTimeout(0)`）逐段渲染；首屏以下的圖表用 `IntersectionObserver` 進入視窗前一點才建立。
4. **A4 `content-visibility:auto`**：面板第 2 個以後的 `section` 加 `content-visibility:auto; contain-intrinsic-size:auto 900px`（已量測 −17～24%）。注意區段跳轉列（`ui-comfort.js` 的 section bar）：跳到尚未渲染的區塊時，先 `scrollTo` 一次，等 `contentvisibilityautostatechange` 或下一格再校正一次，避免落點偏移；`markSection` 的位置判斷照常可用。
5. **A5 表格整理去除讀寫交錯**：`ui-comfort.js` 的 `foldTables()` 每張表「寫 class → 讀 scrollWidth」會觸發多次排版；改成先讀所有表格尺寸、再一次寫入；可行時改用 CSS container queries 取代 JS 量測。

**B 組：觸控裝置的玻璃降級（外觀幾乎不變）**
6. **B1 抽屜與工具面板**：觸控裝置（`(pointer: coarse)`）不使用 SVG 位移折射，只用 `blur()+saturate()`；抽屜 p95 67→11 ms。
7. **B2 捲動中暫停折射**：捲動時在 `<html>` 加 `fl-scrolling`（scroll 事件，停止 150 ms 後移除），期間黏性列改用一般模糊；捲動最差格約減半。
8. **B3 固定背景移到合成層**：`body` 的星點背景 `background-attachment: fixed` 會在捲動時重繪；把星點合併進已存在的固定 `body::before` 場景層（本身已是獨立合成層）。
9. **B4 文字陰影只留在玻璃列**：`text-shadow` 目前套在大量內容文字上；只保留在頂列、切換列、抽屜等壓在背景上的文字。

**C 組：動畫品質細節**
10. **C1 滑塊不要動畫 `width`**：`.fl-tab-thumb`、`.fl-subnav-thumb` 目前 transition `width`/`height`（每格排版）；改為固定基準寬度＋`transform: translateX() scaleX()`。
11. **C2 按壓不用 `filter`**：卡片按壓 `filter: brightness(1.12)` 會重繪整張卡；改用 `::after` 白色覆蓋層的 `opacity`。
12. **C3 收斂 Tailwind `transition`**：Tailwind 的 `transition` 類別會同時轉場 `box-shadow`、`filter`、`backdrop-filter`；在 `ui-theme.css` 覆寫 `html.ui-flight .transition { transition-property: color, background-color, border-color, opacity, transform; }`。
13. **C4 場景背景預解碼與縮小**：每頁背景 2560×1440（直式 1290×2400），換頁時要解碼數十 MB 點陣圖；閒置時以 `new Image(); img.decode()` 預先解碼相鄰頁場景，手機改用約 1080 寬的直式版本（可評估 AVIF）。
14. **C5 View Transitions（選做）**：A 組完成後，可用 `document.startViewTransition()` 做換頁交叉淡入（Chrome 111+、Safari 18+，不支援時沿用現有動畫）；在 A 組之前做沒有效果（凍結仍在）。
15. **C6 `will-change` 衛生**：只在動畫期間加 `will-change`，結束移除，避免常駐大量合成層吃記憶體。

### 5.3　驗收標準（手機視窗、CPU 降速 4 倍）
- 換頁（分析、紀錄、球員、場記）：最長單格 ≤ 250 ms，淡入動畫期間無 >50 ms 的格。
- 回到已看過且資料未變的頁面：最長單格 ≤ 50 ms。
- 捲動 3 秒：0 格 >25 ms。
- 抽屜、工具面板開啟：p95 ≤ 17 ms。
- 按鈕點擊到畫面回應（Event Timing / INP）：≤ 100 ms（目前約 40 ms，不得退步）。
- 既有 28 組瀏覽器測試全過；新增 D1–D4 失敗流程測試。

---

## 6. 新增回歸測試清單
- `ui-sync-drafts`：D1（失敗→重開→保留→重送成功）、D1b（離線重開用本機快取）、刪除墓碑。
- `ui-finalize-lock`：D2（上傳中不可登打、成功與失敗兩路徑）。
- `local-cache` 單元測試：D3（localStorage 滿＋IndexedDB 失敗 → 回報失敗、保留佇列、恢復後重試成功；兩階段刪除副本）。
- `ui-review-spray`：D4（新增打席不畫點、改守位不畫點、點選落點才畫點）。
- `ui-render-dirty`：R1/R2（資料不變時重新進頁不重建圖表；改篩選後所有頁在下次進入時更新）。
- 動畫量測腳本納入 `tests/`（不進 CI 也可，作為手動基準）：輸出每情境 frames／long／p95／max。

---

## 附錄：重現所用的關鍵程式位置（a8e0d41）
- 資料載入：`index.html:2567`（`loadDatabaseSource`）
- 寫入：`index.html:2766`（`commitJsonFile`）、`8276`（`commitGamesToGitHub`）、`4841`（logs）
- 每局上傳：`index.html:9575`；完賽：`index.html:9591`
- 覆盤新增打席：`index.html:10495`；覆盤表單套用：`index.html:10594`
- 噴流圖座標判斷：`index.html:5977、6090、6894、10137、10677`
- 換頁渲染：`index.html:3275`；整站重繪：`index.html:8055`
- 本機快取：`local-cache.js`（`set`、`mirror`、`flush`）
- 健康資料草稿範例：`player-health-store.js`
- Token：`index.html:2476`；風險接受：`README.md` 第 17 行附近
- Discord 依賴：`discord/package.json`（`discord.js@14.27.0`）
