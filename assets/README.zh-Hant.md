<p align="center">
  <img src="banner.zh-Hant.svg" width="100%" alt="CF ImgHub — 為個人部落格打造的圖床">
</p>

<h1 align="center">CF-ImgHub</h1>

<p align="center">
  為個人部落格打造的圖床，跑在 Cloudflare Workers + R2 上。<br>
  快，瀏覽器本機壓縮，且支援實況照片與 HDR。
</p>

<p align="center">
  <a href="https://github.com/TG-Twilight/CF-ImgHub/fork"><img src="fork.zh-Hant.svg" alt="Fork 並部署"></a>
</p>

<p align="center">
  <a href="../README.md">简体中文</a> · <b>繁體中文</b> · <a href="README.en.md">English</a>
</p>

## 特色

### 快

圖片直接從 Cloudflare 邊緣回傳：先查快取，未命中再讀 R2，中間沒有資料庫，也不繞道第三方儲存。

### 自動壓縮

圖片在上傳前預設會經過一次壓縮（瀏覽器本機完成），預設轉 **AVIF**，也可選 WebP / JPEG / PNG 或不壓縮；提供檔位選擇，可限制最長邊，當然，**壓完變大時自動用原圖**。

### 實況照片與 HDR

上傳時依檔案內容辨識實況照片（Google Motion Photo、OPPO / 一加 / realme 的 O Live，含微信轉存）和 HDR 照片（Ultra HDR / ISO 21496-1 增益圖）。HDR 照片、動圖、SVG、ICO、影片原樣上傳；實況照片拆開壓縮後按原結構裝回，相簿照樣辨識：

| 檔位 | 做法 |
|------|------|
| 原樣 | 不改動 |
| 精簡 | 去掉手機私有資料，畫質無損 |
| **標準**（預設） | 再重新壓縮主圖，HDR 與影片都保留，體積約減半 |
| 緊湊 | 再把實況影片轉為 SDR |
| 極致 | 再去掉 HDR，主圖按最長邊縮小 |

伺服器從不改動檔案位元組。

## 其他功能

- **兩種身分**：上傳者只需密碼，可撤回 24 小時內的上傳；管理員可瀏覽、搜尋、批次刪除和修改設定
- **防盜鏈**：可自訂放行網站，單張圖片可單獨放行；直接開啟和 RSS 閱讀器不受影響
- **易讀的檔名**：預設 `ImgHub-20261121-153045-k7q2.avif`，也可保持原名
- **主題色、深淺色、多網域、背景圖、快捷連結**：都在設定頁調整；深淺色可強制統一
- **Telegram 儲存（選用）**：作為 R2 的備份，或只存 Telegram 以實現近乎無上限的儲存
- **去除定位**：上傳前清除照片與影片裡的 GPS，不動畫質、實況與 HDR（預設開啟，可關）
- **腳本上傳**：用 Bearer Token 呼叫 `/api/upload`
- Material 3 Expressive 介面，亮 / 暗色，自訂色彩搭配，简体中文 / 繁體中文 / English

## 截圖

<details>
<summary>展開截圖</summary>

**上傳頁**

<img src="screenshots/upload.avif" width="100%" alt="上傳頁">

**後臺管理**

<img src="screenshots/admin.avif" width="100%" alt="後臺管理">

**圖床設置**

<img src="screenshots/settings.avif" width="100%" alt="圖床設置">

**登入頁**

<img src="screenshots/login.avif" width="100%" alt="登入頁">

</details>

## 部署

<details>
<summary>展開部署步驟</summary>

準備：一個 Cloudflare 帳戶（免費版即可）和一個 GitHub 帳戶，想用自己的網域需要將其託管在 Cloudflare。

### 第 1 步：Fork 並部署

部署時要用到下面 5 個密鑰：

| 名稱 | 填什麼 |
|------|------|
| `SESSION_SECRET` | 一串隨機長字串，用來簽署登入工作階段 |
| `UPLOAD_PASSWORD` | 上傳頁的密碼 |
| `ADMIN_USER` | 管理頁的帳號 |
| `ADMIN_PASSWORD` | 管理頁的密碼 |
| `UPLOAD_TOKEN` | 腳本上傳用的 Token；不用腳本也請填一串隨機字元 |

隨機字串可以用密碼管理器產生，或在終端機執行 `openssl rand -hex 32`。名稱區分大小寫，值的前後不要帶空格。

1. [Fork 本倉庫](https://github.com/TG-Twilight/CF-ImgHub/fork) 到你的 GitHub 帳戶
2. 打開 [Cloudflare 主控台](https://dash.cloudflare.com/)，左側選「R2 物件儲存」→「建立儲存桶」，名稱填 `cf-imghub`
3. 左側選「Workers 和 Pages」→「建立」→「匯入存放庫」
4. 第一次使用要先連接 GitHub：點「連接 GitHub」，在跳出的 GitHub 頁面選擇你的帳戶，安裝並授權 **Cloudflare Workers and Pages** 應用程式。倉庫權限選「All repositories」，或選「Only select repositories」並勾選剛 Fork 的倉庫
5. 回到 Cloudflare，選擇你的 GitHub 帳戶和剛 Fork 的倉庫，點「下一步」
6. 專案名稱填 `cf-imghub`（必須與倉庫裡 `wrangler.jsonc` 的 `name` 一致），建置指令填 `npm run build`，部署指令保持 `npx wrangler deploy`
7. 點「部署」，等待建置完成（約 1–2 分鐘）
8. 進入 `cf-imghub` →「設定」→「變數和密碼」，按上表逐個「新增」，類型選「密碼」，最後點「部署」

完成後會得到一個 `https://cf-imghub.<你的子網域>.workers.dev` 網址，已經可以打開使用。

**以後更新**：在你 Fork 的倉庫頁面點 **Sync fork** →「Update branch」，Cloudflare 會自動重新部署。

### 第 2 步：綁定自己的網域（建議）

`workers.dev` 網址無法讀取 Cloudflare 的邊緣快取，每次都要讀 R2，因此正式使用強烈建議綁定網域：

1. 打開 [Cloudflare 主控台](https://dash.cloudflare.com/)，左側選「Workers 和 Pages」，點進 `cf-imghub`
2. 進入「設定」→「網域和路由」→「新增」→「自訂網域」
3. 填寫子網域，如 `img.example.com`，確認。DNS 記錄和憑證會自動建立，幾分鐘內生效

### 第 3 步：確認可以用

1. 打開 `https://img.example.com/`，輸入上傳密碼，傳一張圖片，複製回傳的連結在新分頁打開
2. 打開 `https://img.example.com/admin`，用管理帳號登入，能看到剛才那張圖

防盜鏈預設關閉，要開啟時，先在設定頁的「放行網站」把預置的範例網域換成你部落格的網域（子網域一併放行），再打開開關，否則部落格裡的圖片會被擋下。

### 第 4 步（選用）：加上 Telegram 儲存

不需要可以跳過，只用 R2 也能正常使用。三種存法：

| 模式 | 說明 |
|------|------|
| 僅 R2（預設） | 最快 |
| R2 + Telegram | 照常從 R2 讀取，另存一份到 Telegram（容災）；R2 裡找不到時自動改從 Telegram 讀 |
| 僅 Telegram | 不佔 R2 空間（R2 只留很小的索引）；沒被快取的圖片首次開啟慢 0.5–3 秒 |

（受 Cloudflare Workers 請求體限制，各模式下單個上傳檔案最大 100MB。）

1. **建立 bot**：在 Telegram 開啟 [@BotFather](https://t.me/BotFather)，傳送 `/newbot`，依提示命名，最後會收到形如 `123456789:AA…` 的 token。token 相當於 bot 的密碼，不要公開
2. **建立頻道**：新建一個頻道，設為私人即可
3. **把 bot 設為頻道管理員**：頻道資訊 →「管理員」→「新增管理員」，搜尋 bot 的使用者名稱，至少勾選「發布訊息」和「刪除訊息」
4. **取得頻道 id**：在電腦瀏覽器開啟 [Telegram Web](https://web.telegram.org/a/)，點進這個頻道，網址列 `#` 後面形如 `-1001234567890` 的數字就是（連同減號）
5. **填密鑰**：「Workers 和 Pages」→ `cf-imghub` →「設定」→「變數和密鑰」→「新增」，類型選「密鑰」，分別新增 `TG_BOT_TOKEN`（第 1 步的 token）和 `TG_CHAT_ID`（第 4 步的 id），再點「部署」
6. **選模式**：開啟 `https://img.example.com/settings`，在「儲存」裡選新上傳存到哪裡
7. **給既有檔案補備份**（選用）：點「備份現有檔案到 Telegram」右側的「開始備份」。檔案多時會被 Telegram 限流，頁面會自動等待後繼續，期間不要關閉頁面

切換模式只影響之後上傳的檔案。刪除圖片時，也會嘗試刪掉頻道裡對應的訊息（受 Telegram Bot API 限制，bot 只能刪除 48 小時以內的訊息；超過 48 小時的圖片刪除後連結同樣立即失效，但頻道訊息需手動清理）。

### 以後修改密碼或設定

都在「Workers 和 Pages」→ `cf-imghub` →「設定」→「變數和密碼」：

- **修改**：點該項右側的編輯，填入新的「值」，再點「部署」
- **新增**：點「新增」，類型選「**密鑰**」，填寫「變數名稱」和「值」，再點「部署」
- 密碼類一律選「密鑰」；選「文字」也能用，但值會明文顯示在面板上
- 修改 `SESSION_SECRET` 會讓所有人重新登入；修改某個密碼只會讓對應的登入失效

多個網域：在 Worker 的「設定 → 網域和路由」再新增自訂網域即可，連結預設跟隨開啟頁面時的網域。把這些網域登記在設定頁的「連結網域」後，上傳頁和管理頁頂欄會出現地球按鈕，可隨時切換連結用哪個網域。

### 常見問題

| 現象 | 原因與處理 |
|------|------|
| 匯入存放庫時找不到 Fork 的倉庫 | Cloudflare 的 GitHub 應用程式沒有這個倉庫的權限。到 GitHub「Settings」→「Applications」→ Cloudflare Workers and Pages →「Configure」，把倉庫加進去 |
| 登入時提示「伺服器尚未設定這種登入方式」 | 缺少 `SESSION_SECRET`，或缺少這個頁面的密碼（上傳頁要 `UPLOAD_PASSWORD`，管理頁要 `ADMIN_USER` 和 `ADMIN_PASSWORD`）。到「變數和密碼」核對名稱拼寫 |
| 提示「密碼不正確」，但確定沒輸錯 | 檢查「值」的前後是否多了空格或換行 |
| 腳本上傳回傳 401 | `UPLOAD_TOKEN` 沒設定，或與腳本裡用的不一致 |
| 部落格裡的圖片顯示不出來 | 開了防盜鏈，但「放行網站」裡沒有部落格的網域 |
| 下載回來的圖片比上傳時小、HDR 效果沒了 | 網域所在區域開了 Polish（Pro 以上方案才有）。在該網域的「規則」裡新建一條設定規則（Configuration Rule）：主機名稱等於圖床網域，Polish 設為關閉 |
| 「儲存」裡後兩個選項是灰的 | 缺少 `TG_BOT_TOKEN` 或 `TG_CHAT_ID`，或名稱拼錯；改完要點「部署」 |
| 備份到 Telegram 失敗 | bot 不是頻道管理員或沒有「發布訊息」權限，或 `TG_CHAT_ID` 漏了前面的 `-100` |

</details>

## 用腳本上傳

```bash
curl -H "Authorization: Bearer $UPLOAD_TOKEN" \
     -H "Content-Type: image/avif" \
     --data-binary @photo.avif \
     "https://img.example.com/api/upload?name=photo.avif&gps=1"
```

回傳 JSON，其中 `url` 為圖片連結。可透過查詢參數自由組合以下功能：

| 參數 | 可選值 | 說明 |
|------|------|------|
| `name` | 檔名 | 原檔名（用於識別類型與產生規範名） |
| `naming` | `std`（預設）/ `original` | `std` 為規範命名，`original` 保持原檔名 |
| `gps` | `1` / `0`（預設） | `1` 時在伺服器端原地清除照片（JPEG/HEIC/AVIF/WebP/PNG）與影片（MP4/MOV）中的 GPS 定位 |
| `live` | `0`（預設）/ `1` / `4` | 實況照片瘦身：`1` 無損去掉手機私有尾部與除錯段；`4` 再去掉 HDR 增益圖 |
| `exempt` | `1` / `0`（預設） | `1` 時將該檔案單獨加入防盜連放行名單（允許外連） |
| `domain` | 網域 | 指定回傳 `url` 使用的網域（如 `img2.example.com`） |
| `storage` | `r2` / `r2+tg` / `tg` | 單獨指定本次上傳的儲存方式（不傳則跟隨後臺設定） |

## 本機開發

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入密鑰
npm run dev
```

## 授權

[AGPL-3.0-or-later](../LICENSE)。圖示來自 [Material Icons](https://github.com/google/material-design-icons)（Apache-2.0）；瀏覽器端編碼器來自 [jSquash](https://github.com/jamsinclair/jSquash)（Apache-2.0），影片處理用 [Mediabunny](https://github.com/Vanilagy/mediabunny)（MPL-2.0），均在建置時複製，不在倉庫中。
