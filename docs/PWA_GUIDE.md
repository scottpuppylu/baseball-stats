# 航太系壘 PWA 安裝與使用

正式網址：<https://scottpuppylu.github.io/baseball-stats/>。使用網站與安裝 PWA 都不需登入、註冊、輸入 Token 或申請授權。所有裝置共用同一套棒球功能與 GitHub data。

## Windows

直接用 Chrome／Edge 開啟網站即可使用。也可按網址列的安裝圖示或瀏覽器選單中的「安裝此應用程式」，從桌面／開始功能表開啟。其他瀏覽器仍可用一般網站模式。

## Android Chrome

1. 用 Chrome 開啟正式網址，首次使用保持連線並等資料載入。
2. 使用頁面出現的「安裝」，或 Chrome 選單中的「安裝應用程式／加到主畫面」。
3. 確認「淡江航太系壘」與隊徽後安裝，從主畫面圖示開啟。

瀏覽器、手機服務與版本可能影響選單名稱或提供完整安裝／捷徑的方式；不需下載本專案 APK。安裝條件與瀏覽器差異見 [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

## iPhone Safari

1. 用 Safari 開啟正式網址。
2. 按「分享」→「加入主畫面」。若沒有這個動作，可到分享選單底部的「編輯動作」加入。
3. 若顯示「開啟為 Web App」，保持開啟，再按「加入」。
4. 從主畫面隊徽啟動，使用獨立視窗模式。

圖示由 apple-touch-icon／manifest 提供，保留深色介面與安全區域；實際啟動畫面由作業系統決定。參見 [Apple 官方說明](https://support.apple.com/guide/iphone/iphea86e5236/ios)。本次未持有實體 iPhone／Android，實機安裝、Splash 與分享選單行為均標示 **UNVERIFIED**。

## 資料同步

線上直接使用原 GitHub Contents API。寫入前重新讀取 SHA，三方合併其他裝置的變更；409 會重新讀取及重試，持續衝突則提示稍後重試。同一筆資料兩邊都修改時，沿用原本本機優先並提示衝突的規則。這不是跨多個 JSON 的原子交易，不應把網路失敗視為已完成全部上傳。

看見「寫入失敗」時，不要清除瀏覽資料或解除安裝，先下載「完整備份」JSON、保留本機場記，再重試。只有顯示成功的上傳才可視為已同步。正式資料不會因安裝 PWA 而自動複製到另一個資料庫。

## 離線與恢復

首次必須連線開啟並等離線資源安裝完成，之後才有離線啟動能力。PWA 只快取本網站列入清單的靜態檔與**已移除憑證的 HTML**；GitHub/API/data 回應不進 Service Worker 快取。既有本機資料儲存與場記恢復維持原樣。

離線資料可能過期，雲端同步暫停，不會假裝成功。網路不可達時即使瀏覽器仍認為在線，也會顯示離線版本提示。恢復連線後按提示的「重新整理數據」，載入線上頁面及最新雲端資料，再依原功能同步。重新開啟前保留未完成的本機場記；瀏覽器的無痕模式、系統清理或刪除網站資料會影響本機保存，PWA 不能代替完整備份。

## 新版本

連線使用時會檢查 Service Worker 更新，出現「有新版本」後可選「稍後」或「立即更新」。不會在首次安裝時自動重新整理；更新啟用須由使用者同意。已存入本機的進行中場記會在重新載入後恢復。多個頁籤請先完成當下輸入，再接受更新。

## 安全風險與部署

既有網站的可寫入 Token 是公開且可還原的，字元陣列不是秘密保護；Product Owner 已接受這項風險，列為 **RISK_ACCEPTED，並非 SECURITY_PASS**。Token 值、權限不變，也沒有新後端或登入。離線快取移除 Token 只是避免新增副本，不能修復原本的公開風險。

發布與回滾見 [PWA_ROLLBACK.md](PWA_ROLLBACK.md)；自動化及實機驗證邊界見 [PWA_RELEASE_REPORT.md](PWA_RELEASE_REPORT.md)。Android 原生工程、APK、Release 簽章、Google OAuth、Vercel／Cloud API 教學均已作廢。
