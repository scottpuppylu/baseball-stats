# PWA 自動發布與更新

## 自動版本與完整版本

`scripts/build-pwa.cjs` 對 HTML、Worker、所有引用程式、樣式、manifest 與圖示計算內容指紋；JS／CSS 即使沒有人工修改版本，資源 URL 與發布版本也會改變。相同輸入可重現相同版本，重複 build 結果不變。僅在部署工作區原地改寫原 index.html 的資源連結及版本 meta，全部 inline 業務程式與原憑證宣告保持不變。

main 的 CI 通過完整測試後，部署 job 才 build、移動公開檔案到 Pages artifact，沒有額外 API／後端。data 的既有公開 fallback 繼續部署，但不進入 Worker 快取；正式寫入仍直接走 GitHub Contents API 的 data 分支。往後更新網站請走 PR→CI→main 這條流程；手動上傳未 build 的來源不是支援的發布方法。

新 Worker 安裝時使用 no-store 逐檔下載並驗證 SHA-256；全部完成才標記完整、成為 waiting。任何缺檔、內容錯誤、斷線或儲存失敗會刪除該次 staging cache，原 active release 不變。activate 清除舊完整版本及舊固定快取，但保留另一個仍在下載的 installer，避免併發切換破壞更新。

受控頁面的 HTML、JS、CSS 一律使用該 Worker 的完整快照；發布 V2 不會讓仍在 V1 的頁面讀到 V2 HTML。資源帶內容雜湊，已清除的舊資源請求會拒絕，不會偷偷代入新程式。首次尚未安裝 Worker 的一般網站仍依正常瀏覽器網路載入；完整下載後才提供離線版本。

## 更新保護

前景、pageshow、focus、online 及每分鐘檢查（15 秒節流）呼叫 registration.update，updateViaCache 為 none。完整新版提供立即更新／稍後；稍後保留舊版並延後提醒五分鐘。

立即更新先檢查 activeGame、未儲存輸入、開啟的編輯視窗、在途寫入與 localStorage 可用性。Worker 再向同 scope 所有頁面要求安全確認；有場記、編輯或三秒內無回應就拒絕。僅主動接受且再次通過安全檢查的頁面會重載，其他已開啟頁面不強制重新整理。場記不改寫 schema、不搬移儲存；關閉重開仍由原本的恢復流程還原。

既有固定版本客戶端不懂安全確認，其 SKIP_WAITING 被拒絕；第一次需先儲存／備份、關閉網站及 PWA 視窗再開啟。已用實際舊版 Worker 與 pwa.js 的隔離測試驗證場記恢復。之後皆使用新提示，不需卸載重裝。

## 原憑證與資料

既有公開 Token 風險為 **RISK_ACCEPTED，不是 SECURITY_PASS**。值、權限、直接 API 行為不變。發布沒有新增憑證檔：原 index.html 就地處理再移動至公開 artifact；Worker／版本描述只存指紋。CacheStorage 的 HTML 會完全移除宣告值，線上僅從原 public index.html 取回原宣告、在記憶體回填到同一路徑的頁面回應，不寫入其他檔案／快取。離線沒有憑證，雲端寫入會誠實失敗並保留本機資料；重連後重開取得原直接寫入能力。

Worker 不攔截任何非 GET、GitHub、data／API 路徑；沒有 API 過期快取。既有公開 serviceWorker:false 可在線停用快照及其資源雜湊，重新開啟後清除 Worker／程式快取，保留 localStorage。隔離測試使用真正改版的 app-config 及雜湊網址演練此回滾。

## 可追溯驗證

- `npm test`：原有完整回歸及新 PWA／WebKit 組。
- `npm run test:pwa`：安裝、離線、更新、遷移、回滾、啟動及手機版面。
- `npm run test:apple`：WebKit 六視窗及 Apple 相關功能；不等於實機。
- `tests/pwa-release.test.cjs`：可重現版本、JS／CSS-only、業務碼不變、併發快取清理。
- `tests/ui-pwa-update.cjs`：V1 延後／重開、V2 確認、資料保留、多頁阻擋、損壞檔與實際連線截斷、前景偵測。
- `tests/ui-pwa-migration.cjs`：正式舊固定版本到新更新協定。
- `node scripts/pwa-release-audit.cjs`：原憑證相同、無額外副本、公式模組相同、data 無變更。
- `node scripts/pwa-production-smoke.cjs`：正式唯讀，驗證 build 後檔案與版本、十頁、離線及資料；非 GET/HEAD 雙層阻擋。

Apple 實機狀態、版本矩陣與人工清單見 [APPLE_PWA_ACCEPTANCE.md](APPLE_PWA_ACCEPTANCE.md)；回滾操作見 [PWA_ROLLBACK.md](PWA_ROLLBACK.md)。
