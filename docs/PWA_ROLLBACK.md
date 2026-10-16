# GitHub Pages 發布與回滾

GitHub Pages 使用 `test.yml` 的測試後部署工作：main 通過全部測試，才以檔案 SHA-256 產生完整發布版本，交給 Pages。仍是靜態網站，沒有額外服務。正式資料獨立位於 `data` 分支，不能透過程式回滾去 reset／覆寫它。

## 正常發布

1. 開發分支完成 `npm test`、`node scripts/pwa-release-audit.cjs` 及回滾演練。
2. 確認既有憑證宣告完全相同、沒有額外副本，紀錄 RISK_ACCEPTED。新增風險與資料問題不能略過。
3. Commit、Push、建立 PR，必要 GitHub Actions 全部成功才合併 main。安全保護若拒絕，不能 bypass、關閉保護或更換方式規避。
4. 等既有 Pages 發布成功，執行 `node scripts/pwa-production-smoke.cjs`。此檢查只讀取，阻擋全部非 GET/HEAD，驗證正式檔案與 commit、十頁、離線快取、離線啟動及 data SHA。

## 已準備的 PWA 回滾

本次業務／同步程式沿用原 main `40f2c23`；新增的 PWA 快取層可用既有 `serviceWorker: false` 公開設定停用。`scripts/rollback-pwa.cjs` 只產生／套用這一個設定，不讀取、備份或修改 Token，不觸碰 index.html、localStorage 或 data。

```bash
node scripts/rollback-pwa.cjs --check
node tests/run-all.cjs ui-pwa-rollback
```

隔離預覽 `/baseball-stats/?rollback` 使用相同的 false 設定，驗證只註銷本網站 scope、清除 `tkaero-shell-*` 快取、保留進行中場記、十頁與直接 fixture 寫入正常。此為已執行的隔離回滾演練，不是正式切換。

## 真正需要回滾時

從當時最新 main 建立修復分支：

```bash
node scripts/rollback-pwa.cjs --apply
npm test
node scripts/pwa-release-audit.cjs
```

它只修改 app-config.js 的公開布林值，仍保留原網站直接讀寫、manifest 與統計。檢查差異後用新 commit 走 PR／CI，再正常合併 main。禁止 force push、reset 遠端或回復 data 快照。

這個回滾停用 PWA 離線層，讓在線使用回到原網站功能；不是任意程式缺陷的通用修復。若問題在其他程式，需另以已驗證版本做最小程式 revert，保持同一憑證宣告與資料格式，執行對應回歸後再發布，不能用尚未驗證的整分支回退。

Pages 完成後，連線開啟網站確認功能、資料與 SW 清除，核對 data SHA 未變。離線裝置無法立即取得回滾，其他已開啟頁籤也可能暫時仍受舊 worker 控制，需連線後重新開啟。不要刪除使用者網站資料來換取成功。

回復 PWA 時，以另一個正常版本啟用開關，再執行測試與 CI；版本及資源網址由 build-pwa 自動產生，不需手動修改 VERSION 或 ?v=。
