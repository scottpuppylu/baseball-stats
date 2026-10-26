# 第三方程式（本機副本）

網站、PWA 與 Android App 共用這些檔案，讓 App 不依賴外部 CDN、PWA 離線時也能開啟畫面。版本與原本網站從 CDN 載入的完全相同。

| 檔案 | 來源 | 授權 | SHA-256 |
| --- | --- | --- | --- |
| `chart.umd-4.5.1.min.js` | npm `chart.js@4.5.1` 的 `dist/chart.umd.min.js`（npm integrity 已驗證；與 `cdn.jsdelivr.net/npm/chart.js@4.5.1` 位元組相同） | MIT | `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a` |
| `tailwindcss-play-3.4.17.js` | `https://cdn.tailwindcss.com/3.4.17`（原網站載入的 `cdn.tailwindcss.com` 目前即導向此版本） | MIT | `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15` |
| `fonts/inter-latin-{400,500,600,700}.woff2` | npm `@fontsource/inter@5.3.0`（npm integrity 已驗證）的 Latin 子集；僅英數字，中文使用系統字型 | SIL OFL 1.1（`fonts/Inter-OFL.txt`） | 400 `8909904a…`、500 `f3779f1e…`、600 `f9a06e79…`、700 `6f56409f…` |
| `fonts/tk-sans-{400,500,700}.woff2`、`fonts/tk-serif-600.woff2` | Google Fonts 儲存庫 `ofl/notosanstc`、`ofl/notoseriftc`（Adobe 思源黑體／思源宋體 TC 可變字型），由 `scripts/build-fonts.py` 固定字重並只保留網站用到的 1,333 字（清單：`fonts/tk-charset.txt`）；其他字自動改用系統字型 | SIL OFL 1.1（`fonts/NotoTC-OFL.txt`） | 重新產生：`python scripts/build-fonts.py <NotoSansTC[wght].ttf> <NotoSerifTC[wght].ttf>` |

更新版本時：換檔名中的版本號、更新上表、同步修改 `index.html` 與 `sw.js` 的檔名，並重跑 `npm test`。

`tailwind-site.css` 由 `node scripts/build-tailwind.cjs` 以上表的 `tailwindcss-play-3.4.17.js` 在無頭瀏覽器中產生（2026/10/26 起網站改載入此預先產生的 CSS，不再於瀏覽器即時編譯；Play 檔案保留作為產生工具）。
