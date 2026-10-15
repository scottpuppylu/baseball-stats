# 淡江航太系壘 App（PWA 與 Android）

> 2026/10/16 Phase 6 更正：產品要求零登入、零 Token 輸入、零隊員設定。以下 §1 的 OAuth/API 是前任留下的實驗方案，**未獲採用、未部署，也不是發布先決設定**；不得要求使用者完成它。正式站保持原狀，本分支的雲端寫入尚未符合需求，發布 BLOCKED。最新證據與替代架構見 [PHASE6_REPORT.md](PHASE6_REPORT.md)。

同一套網頁程式有三種用法，資料、計算公式與功能完全相同：

| 用法 | 來源 | 適合 |
| --- | --- | --- |
| 網站 | <https://scottpuppylu.github.io/baseball-stats/> | 電腦、臨時查看 |
| PWA（加入主畫面） | 同一個網址，從瀏覽器安裝 | iPhone、Android 皆可，免下載 APK |
| Android App | `android/` Capacitor 專案建置的 APK | 需要原生返回鍵、分享面板、離線開啟的 Android 手機 |

App 內跑的是打包進 APK 的網站檔案（`npm run build:web` 產生的 `www/`），不是指向 GitHub Pages 的網址殼。統計公式、打線模型、場記邏輯、`data` 分支與 JSON 格式都沒有改動。

---

## 1. 安全寫入 API（取代網頁內的 GitHub Token）

### 為什麼要改

舊版 `index.html` 內含一組以字元陣列編碼的 GitHub Token。公開網頁裡的任何編碼都能被還原，等於公開了一組可寫入 GitHub 的憑證。這一版：

- 網頁、PWA、APK 內 **沒有任何 GitHub 憑證**（`tests/pwa.test.cjs`、`tests/cloud-sync.test.cjs`、`scripts/build-web.mjs` 都會檢查）。
- 讀取：照舊讀公開的 `data` 分支；設定 API 後改由 API 讀（同樣內容與版本 sha，且不受 GitHub 匿名每小時 60 次的限制）。
- 寫入：只能透過 `cloud-api/`（Vercel Function）。每個人用自己的 Google 帳號登入，API 依 Email 名單判斷角色，再用只存在伺服器的憑證寫入 `data` 分支。

```
網站 / PWA / Android App ──(個人登入的簽章 session)──▶ cloud-api（Vercel）──(伺服器端憑證)──▶ GitHub data 分支
```

### 權限

| 角色 | 設定 | 可寫入 |
| --- | --- | --- |
| 未登入 | — | 不能寫入，只能看公開數據 |
| editor | `EDITOR_EMAILS` | logs、games、guests、avatars、tags |
| admin | `ADMIN_EMAILS` | 以上全部 + defense（教練專用守位排名） |

- 每次寫入都重新比對名單：把某人從名單移除，他未過期的登入立刻失效。
- 只能寫 `scottpuppylu/baseball-stats` 的 `data` 分支、`data/` 下六個檔案；程式寫死分支必須是 `data`。
- 寫入前驗證資料形狀（陣列/物件、每筆有 id/name、禁止 `__proto__` 等欄位、大小上限 4 MB）。
- 版本衝突（另一支手機先寫入）回 409，網頁照原本機制重新讀取、三方合併、再上傳。
- GitHub 失敗回 502；網頁一律顯示「寫入失敗」並保留本機資料，不會誤報成功。
- 每個 commit 訊息附上 `[via app: 姓名 (角色)]` 作為稽核紀錄。
- CORS 只決定哪些網站能讀回應，不是權限控制；權限只看伺服器驗證過的簽章 session。

### 登入流程（Google OpenID Connect）

1. 網頁產生一次性 verifier，把它的 SHA-256 當 `challenge` 送到 `GET /api/auth/login`。
2. API 轉到 Google 登入（網頁：同一個分頁；Android：系統瀏覽器 Custom Tab，因為 Google 禁止在內嵌 WebView 登入）。
3. Google 回到 `/api/auth/callback`，API 在伺服器端用 client secret 換取並檢查 ID token（issuer、audience、nonce、Email 已驗證、名單內）。
4. API 帶著 2 分鐘有效、綁定 challenge 的一次性代碼回到網站（網址 `#fragment`，不會送到任何伺服器）或 App（`io.github.scottpuppylu.baseballstats://auth`）。
5. 網頁用 verifier 換取 12 小時的 session。攔截到代碼的其他 App 沒有 verifier，無法使用。

### 啟用步驟（需要你本人操作）

> 在完成這些步驟前，網站可以正常瀏覽，但雲端寫入會明確顯示「尚未啟用」，資料保存在本機。

1. **GitHub 細粒度權杖**：GitHub → Settings → Developer settings → Fine-grained tokens → Generate。
   Repository access 只選 `scottpuppylu/baseball-stats`；Permissions 只開 **Contents: Read and write**；設定到期日。
2. **Google OAuth 用戶端**：Google Cloud Console → APIs & Services → OAuth consent screen（External，填 App 名稱、你的 Email）→ Credentials → Create OAuth client ID → **Web application**。
   Authorized redirect URI：`https://<你的 API 網域>/api/auth/callback`。
3. **Vercel 專案**：Vercel → Add New Project → 匯入 `scottpuppylu/baseball-stats` → **Root Directory 設為 `cloud-api`** → Framework: Other。
   在 Settings → Environment Variables 依 `cloud-api/.env.example` 填入：`GITHUB_DATA_TOKEN`、`SESSION_SECRET`（`node -e "console.log(crypto.randomBytes(48).toString('base64url'))"`）、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`API_PUBLIC_URL`、`ADMIN_EMAILS`、`EDITOR_EMAILS`、`ALLOWED_ORIGINS`、`ALLOWED_RETURN_URLS`。部署。
4. 確認 `https://<API 網域>/api/health` 回傳 `{"ok":true,"auth":true,"writes":true,"branch":"data"}`。
5. 把 API 網址填入 `app-config.js` 的 `apiBase`（例如 `'https://baseball-stats-api.vercel.app'`），重新建置 APK（`npm run build:android`），合併到 `main` 讓網站生效。

建議同時在 GitHub → Settings → Rules 為 `main` 加上「需要 PR、禁止 force push」，即使伺服器憑證外洩也無法改網站程式。

### 遷移與回滾

| 步驟 | 動作 | 回滾 |
| --- | --- | --- |
| 0 | **立即撤銷舊 Token**（見 §5）。撤銷後，舊網頁的雲端寫入會失敗（明確顯示失敗，本機資料保留），讀取不受影響。 | 不回滾；舊 Token 已公開，必須作廢 |
| 1 | 依上節部署 API，`/api/health` 正常 | 刪除 Vercel 專案即可，對網站無影響 |
| 2 | 在 PR 預覽或本機以 `apiBase` 指向新 API，用 editor 帳號試寫一筆測試資料後刪除 | 同上 |
| 3 | 合併 PR，網站改用新寫入流程 | `git revert` 合併 commit；或把 `apiBase` 設回 `''`（寫入停用、只讀） |
| 4 | 觀察 `data` 分支 commit 訊息中的 `[via app: …]` | 任何錯誤寫入都可用 `git revert` 還原該 commit |

`data` 分支的格式與檔案完全沒變；舊的 `main → data` 自動合併已確認完成（`data/legacy-main.json` 與 `main` 的 `data/` 版本一致）並停用。

---

## 2. PWA

- `manifest.webmanifest`：名稱「淡江航太系壘」、短名「航太系壘」、`display: standalone`、`start_url`/`scope` 為 `./`（對應 `/baseball-stats/`）、192/512 與 maskable 圖示。
- `sw.js`：只快取本站帶版本號的程式檔；**不快取**任何 `data/*.json`、GitHub、API、Google 登入請求。
- 離線時仍可開啟，頂部顯示「離線中：顯示本機暫存資料，可能不是最新；雲端同步暫停」，上傳會明確失敗，恢復連線後提示重新整理。
- 有新版時顯示「有新版本可用 · 立即更新」，由使用者決定何時重新載入（場記進度保存在本機，重新載入後恢復）。
- 緊急關閉：`app-config.js` 設 `serviceWorker: false`，所有訪客下次開啟時自動移除 Service Worker 與快取。
- 更新程式時：改 `index.html` 的 `?v=` 版本號，並同步 `sw.js` 的 `SHELL` 清單與 `VERSION`（`tests/pwa.test.cjs` 會檢查是否一致）。

### iPhone 安裝（Safari）

1. 用 **Safari** 開啟 <https://scottpuppylu.github.io/baseball-stats/>。
2. 點下方「分享」按鈕 → 「加入主畫面」。
3. 名稱保留「航太系壘」→「加入」。之後從主畫面開啟即為全螢幕 App。
4. 編輯資料：點右上角 🔐 → Google 登入（第一次會開啟 Google 頁面，完成後自動回到 App）。

### Android 安裝 PWA（Chrome）

開啟網址 → 畫面下方出現「📲 安裝」或 Chrome 選單 → 「安裝應用程式」。

---

## 3. Android App

| 項目 | 值 |
| --- | --- |
| App 名稱 / ID | 淡江航太系壘 / `io.github.scottpuppylu.baseballstats` |
| Capacitor | 8.5.3（穩定版） |
| minSdk / targetSdk / compileSdk | 24（Android 7.0）/ 36 / 36 |
| 權限 | `INTERNET`、`ACCESS_NETWORK_STATE`（偵測離線，系統自動授與，不跳詢問） |
| 版本 | `android/app/build.gradle` 的 `versionName` / `versionCode` |

原生行為（`app-native.js`，網站上不作用）：

- **返回鍵**：先關閉最上層視窗或選單 → 回到上一個瀏覽的頁面 → 最後把 App 移到背景（不結束、不丟失進行中的比賽）。
- **檔案**：CSV、完整備份 JSON、賽後成績圖改由 Android 分享面板儲存（存到「檔案」、雲端硬碟或傳到 LINE）；`navigator.share` 圖片分享改用原生分享。
- **照片**：頭像上傳使用系統相片挑選器（不需要儲存權限）。
- **離線**：讀取手機實際連線狀態，顯示與網站相同的離線提示。
- **版本**：頁首顯示「網站版本 · App 1.0.0」。
- 不註冊 Service Worker；不允許備份 App 資料（避免登入 session 被雲端備份）。

### 建置

需求：Node.js 22+、JDK 21、Android SDK（platform 36、build-tools）。`scripts/gradle.mjs` 會自動尋找 `%LOCALAPPDATA%\Programs\jdk-21*` 與 `%LOCALAPPDATA%\Android\Sdk`，或使用 `JAVA_HOME` / `ANDROID_HOME`。

```bash
npm ci
npm run build:android
```

產物：`android/app/build/outputs/apk/debug/app-debug.apk`（Debug 簽章，僅供測試，**不是正式發行版**）。

正式版（需要你自己的簽章金鑰，金鑰與密碼不得提交 Git）：

1. `keytool -genkeypair -v -keystore C:\secure\tkaero-release.jks -alias tkaero -keyalg RSA -keysize 4096 -validity 10000`
2. 複製 `android/keystore.properties.example` 為 `android/keystore.properties`（已被 Git 忽略）並填入路徑與密碼。
3. `npm run build:android:release` → `android/app/build/outputs/bundle/release/app-release.aab` 與 `apk/release/app-release.apk`。

### 安裝 APK 到 Android 手機

1. 把 `app-debug.apk` 傳到手機（USB、雲端硬碟或 LINE 檔案）。
2. 在手機上點開檔案 → 若出現「為安全起見，你的手機不允許安裝來自此來源的應用程式」→ 設定 → 允許此來源。
3. 安裝 → 開啟「淡江航太系壘」。
4. 用電腦安裝：開啟手機「開發人員選項 → USB 偵錯」，執行 `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`。

---

## 4. 指令

| 指令 | 作用 |
| --- | --- |
| `npm test` | 全部單元測試與瀏覽器測試（隔離預覽，含真實 API 程式對記憶體 GitHub） |
| `npm run test:unit` | 只跑單元測試 |
| `npm run test:mobile` | PWA、API、Android 專案檢查與手機版面測試 |
| `npm run test:android-device` | 已安裝 Debug APK 的模擬器或手機上實測（十頁、返回鍵、旋轉、重開恢復、分享、相片、鍵盤、離線） |
| `npm run build:web` | 產生 App 用的 `www/` |
| `npm run build:android` | `build:web` + `cap sync` + Debug APK |
| `npm run build:android:release` | 正式 AAB/APK（需 `keystore.properties`） |

CI：`.github/workflows/test.yml`（全部測試）與 `android.yml`（Debug APK，上傳為 artifact）。兩者都不使用任何 repository secret，外部 PR 拿不到憑證；不會自動發布 Release；Actions 版本以 commit SHA 固定。

---

## 5. 現有憑證的處理邊界（Phase 6 更新）

現有 Token 不更換、不撤銷、不修改權限；不把值加入 APK、公開程式碼、報告或 Log。正式站與 Git 歷史的公開憑證風險仍存在，字元陣列或 Base64 都不是安全保護。本次只做唯讀權限檢查，不對正式 data 測試寫入；不得宣稱安全 Gate 已通過。前版要求撤銷 Token 的指示已由 Product Owner 明確取代。
