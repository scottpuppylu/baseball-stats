# Phase 6 網站回滾草案（尚未通過 Gate-09）

> **歷史紀錄／發布判定已作廢。** 2026/10/16 PWA Only 最終指令取消原生 Android 與 OAuth/Cloud API，既有 Token 風險改列 RISK_ACCEPTED。下文保留作歷史證據，不是現行設定教學或 Release Gate。現行驗收以 [PWA_RELEASE_REPORT.md](PWA_RELEASE_REPORT.md) 為準。

2026/10/16：目前未部署本分支，正式站仍是 main@40f2c23，因此本次不執行回滾。

已確認的基線：

- main `40f2c23cf086c7af2e4fc0ee222d6fe7b8ae6633`。
- data `8fdffb297731316bbcf8b6a908033b8d6985ff38`。
- Pages 來源 main 的根目錄，legacy branch deployment。
- 正式頁面原始回應 SHA-256 `d251df9bab8abee31fc4f58fbae1853644d4d9bdba633c046eaee9330f27ec6a`；此值是 HTML 的雜湊，不是 Token 雜湊。

發布前需先完成的演練：

1. 選定能維持完整寫入且沒有嵌入憑證的已測試網站版本。現有舊 main 不符合憑證條件，故目前沒有合格的回滾來源。
2. 在隔離預覽部署該版本，用固定 fixtures 驗證十頁、場記恢復、匯出、讀寫與衝突；掃描回滾產物，確認沒有恢復原 Token literal、字元陣列或其他形式。
3. 記錄發布 commit、main/data SHA、Pages 版本與 SW cache 版本；資料不因程式回滾而重設，不做 Schema migration。

將來需要回滾時：

1. 在開發分支用正常的新 commit 撤回有問題的程式變更，或回復到步驟 1 的核准版本，走 PR／CI。禁止 force push／reset 遠端 main、禁止推動 data ref、禁止恢復正式資料快照來代替程式回滾。
2. 檢查差異只含網站程式；所有 Token／私鑰掃描與功能 Gate 仍須通過。若 revert 會帶回公開嵌入 Token，立刻停止，不發布該版本。
3. 保持 SW VERSION 與所有變更檔案的 URL 版本一致，避免舊檔／新頁混用；必要時使用已有 serviceWorker kill switch，但先在隔離環境驗證其清除路徑。
4. 通過 CI 後正常合併 main，等既有 Pages 發布成功；正式站只做唯讀 Smoke Test，比對頁面／程式指紋與十頁，確認 data SHA 與操作前完全一致。
5. PWA 已快取的離線裝置不會立即收到回滾，需連線後更新；既有原生 APK 也不會因網站回滾而換版，須另處理 APK 發布版本。

尚未演練／執行以上正式切換，不能以此草案宣稱 Gate-09 已通過。
