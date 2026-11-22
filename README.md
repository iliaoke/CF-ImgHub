<p align="center">
  <img src="assets/banner.svg" width="100%" alt="CF ImgHub — 为个人博客打造的图床">
</p>

<h1 align="center">CF-ImgHub</h1>

<p align="center">
  为个人博客打造的图床，跑在 Cloudflare Workers + R2 上。<br>
  快，浏览器本地压缩，且支持实况照片与 HDR。
</p>

<p align="center">
  <a href="https://github.com/TG-Twilight/CF-ImgHub/fork"><img src="assets/fork.svg" alt="Fork 并部署"></a>
</p>

<p align="center">
  <b>简体中文</b> · <a href="assets/README.zh-Hant.md">繁體中文</a> · <a href="assets/README.en.md">English</a>
</p>

## 特点

### 快

图片直接从 Cloudflare 边缘返回：先查缓存，未命中再读 R2，中间没有数据库，也不绕道第三方存储。

### 自动压缩

图片在上传前默认会经过一次压缩（浏览器本地完成），默认转 **AVIF**，也可选 WebP / JPEG / PNG 或不压缩；提供挡位选择，可限制最长边，当然，**压完变大时自动用原图**。

### 实况照片与 HDR

上传时按文件内容识别实况照片（Google Motion Photo、OPPO / 一加 / realme 的 O Live，含微信转存）和 HDR 照片（Ultra HDR / ISO 21496-1 增益图）。HDR 照片、动图、SVG、ICO、视频原样上传；实况照片拆开压缩后按原结构装回，相册照样识别：

| 档位 | 做法 |
|------|------|
| 原样 | 不改动 |
| 精简 | 去掉手机私有数据，画质无损 |
| **标准**（默认） | 再重新压缩主图，HDR 与视频都保留，体积约减半 |
| 紧凑 | 再把实况视频转为 SDR |
| 极致 | 再去掉 HDR，主图按最长边缩小 |

服务器从不改动文件字节。

## 其他功能

- **两种身份**：上传者只需密码，可撤回 24 小时内的上传；管理员可浏览、搜索、批量删除和修改设置
- **防盗链**：可自定放行网站，单张图片可单独放行；直接打开和 RSS 阅读器不受影响
- **易读的文件名**：默认 `ImgHub-20261121-153045-k7q2.avif`，也可保持原名
- **主题色、深浅色、多域名、背景图、快捷链接**：都在设置页调整；深浅色可强制统一
- **Telegram 存储（可选）**：作为 R2 的备份，或只存 Telegram 以实现近乎无上限的存储
- **去除定位**：上传前清除照片与视频里的 GPS，不动画质、实况与 HDR（默认开启，可关）
- **脚本上传**：用 Bearer Token 调用 `/api/upload`
- Material 3 Expressive 界面，亮 / 暗色，自定义色彩搭配，简体中文 / 繁體中文 / English

## 截图

<details>
<summary>展开截图</summary>

**上传页**

<img src="assets/screenshots/upload.avif" width="100%" alt="上传页">

**后台管理**

<img src="assets/screenshots/admin.avif" width="100%" alt="后台管理">

**图床设置**

<img src="assets/screenshots/settings.avif" width="100%" alt="图床设置">

**登录页**

<img src="assets/screenshots/login.avif" width="100%" alt="登录页">

</details>

## 部署

<details>
<summary>展开部署步骤</summary>

准备：一个 Cloudflare 账户（免费版即可）和一个 GitHub 账户，想用自己的域名需要将其托管在 Cloudflare。

### 第 1 步：Fork 并部署

部署时要用到下面 5 个密钥：

| 名称 | 填什么 |
|------|------|
| `SESSION_SECRET` | 一串随机长字符串，用来签名登录会话 |
| `UPLOAD_PASSWORD` | 上传页的密码 |
| `ADMIN_USER` | 管理页的账号 |
| `ADMIN_PASSWORD` | 管理页的密码 |
| `UPLOAD_TOKEN` | 脚本上传用的 Token；不用脚本也请填一串随机字符 |

随机字符串可以用密码管理器生成，或在终端运行 `openssl rand -hex 32`。名称区分大小写，值的前后不要带空格。

1. [Fork 本仓库](https://github.com/TG-Twilight/CF-ImgHub/fork) 到你的 GitHub 账户
2. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，左侧选「R2 对象存储」→「创建存储桶」，名称填 `cf-imghub`
3. 左侧选「Workers 和 Pages」→「创建」→「导入存储库」
4. 第一次使用要先连接 GitHub：点「连接 GitHub」，在跳出的 GitHub 页面选择你的账户，安装并授权 **Cloudflare Workers and Pages** 应用。仓库权限选「All repositories」，或选「Only select repositories」并勾选刚 Fork 的仓库
5. 回到 Cloudflare，选择你的 GitHub 账户和刚 Fork 的仓库，点「下一步」
6. 项目名称填 `cf-imghub`（必须与仓库里 `wrangler.jsonc` 的 `name` 一致），构建命令填 `npm run build`，部署命令保持 `npx wrangler deploy`
7. 点「部署」，等待构建完成（约 1–2 分钟）
8. 进入 `cf-imghub` →「设置」→「变量和机密」，按上表逐个「添加」，类型选「密钥」，最后点「部署」

完成后会得到一个 `https://cf-imghub.<你的子域>.workers.dev` 地址，已经可以打开使用。

**以后更新**：在你 Fork 的仓库页面点 **Sync fork** →「Update branch」，Cloudflare 会自动重新部署。

### 第 2 步：绑定自己的域名（推荐）

`workers.dev` 地址无法读取 Cloudflare 的边缘缓存，每次都要读 R2，因此正式使用强烈建议绑定域名：

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，左侧选「Workers 和 Pages」，点进 `cf-imghub`
2. 进入「设置」→「域和路由」→「添加」→「自定义域」
3. 填写子域名，如 `img.example.com`，确认。DNS 记录和证书会自动创建，几分钟内生效

### 第 3 步：确认可以用

1. 打开 `https://img.example.com/`，输入上传密码，传一张图片，复制返回的链接在新标签页打开
2. 打开 `https://img.example.com/admin`，用管理账号登录，能看到刚才那张图

防盗链默认关闭，要开启时，先在设置页的「放行网站」把预置的示例域名换成你博客的域名（子域名一并放行），再打开开关，否则博客里的图片会被拦下。

### 第 4 步（可选）：加上 Telegram 存储

不需要可以跳过，只用 R2 也能正常使用。三种存法：

| 模式 | 说明 |
|------|------|
| 仅 R2（默认） | 最快 |
| R2 + Telegram | 照常从 R2 读取，另存一份到 Telegram（容灾）；R2 里找不到时自动改从 Telegram 读 |
| 仅 Telegram | 不占 R2 空间（R2 只留很小的索引）；没被缓存的图片首次打开慢 0.5–3 秒 |

（受 Cloudflare Workers 请求体限制，各模式下单个上传文件最大 100MB。）

1. **建 bot**：在 Telegram 打开 [@BotFather](https://t.me/BotFather)，发送 `/newbot`，按提示起名，最后会收到形如 `123456789:AA…` 的 token。token 相当于 bot 的密码，不要公开
2. **建频道**：新建一个频道，设为私有即可
3. **把 bot 设为频道管理员**：频道资料 →「管理员」→「添加管理员」，搜索 bot 的用户名，至少勾选「发布消息」和「删除消息」
4. **取得频道 id**：在电脑浏览器打开 [Telegram Web](https://web.telegram.org/a/)，点进这个频道，地址栏 `#` 后面形如 `-1001234567890` 的数字就是（连同减号）
5. **填密钥**：「Workers 和 Pages」→ `cf-imghub` →「设置」→「变量和机密」→「添加」，类型选「密钥」，分别添加 `TG_BOT_TOKEN`（第 1 步的 token）和 `TG_CHAT_ID`（第 4 步的 id），再点「部署」
6. **选模式**：打开 `https://img.example.com/settings`，在「存储」里选新上传存到哪里
7. **给已有文件补备份**（可选）：点「备份现有文件到 Telegram」右侧的「开始备份」。文件多时会被 Telegram 限流，页面会自动等待后继续，期间不要关闭页面

切换模式只影响之后上传的文件。删除图片时，也会尝试删掉频道里对应的消息（受 Telegram Bot API 限制，bot 只能删除 48 小时以内的消息；超过 48 小时的图片删除后链接同样立即失效，但频道消息需手动清理）。

### 以后修改密码或设置

都在「Workers 和 Pages」→ `cf-imghub` →「设置」→「变量和机密」：

- **修改**：点该项右侧的编辑，填入新的「值」，再点「部署」
- **新增**：点「添加」，类型选「**密钥**」，填写「变量名称」和「值」，再点「部署」
- 密码类一律选「密钥」；选「文本」也能用，但值会明文显示在面板上
- 修改 `SESSION_SECRET` 会让所有人重新登录；修改某个密码只会让对应的登录失效

多个域名：在 Worker 的「设置 → 域和路由」再添加自定义域即可，链接默认跟随打开页面时的域名。把这些域名登记在设置页的「链接域名」后，上传页和管理页顶栏会出现地球按钮，可随时切换链接用哪个域名。

### 常见问题

| 现象 | 原因与处理 |
|------|------|
| 导入存储库时找不到 Fork 的仓库 | Cloudflare 的 GitHub 应用没有这个仓库的权限。到 GitHub「Settings」→「Applications」→ Cloudflare Workers and Pages →「Configure」，把仓库加进去 |
| 登录时提示「服务器尚未设置这种登录方式」 | 缺少 `SESSION_SECRET`，或缺少这个页面的密码（上传页要 `UPLOAD_PASSWORD`，管理页要 `ADMIN_USER` 和 `ADMIN_PASSWORD`）。到「变量和机密」核对名称拼写 |
| 提示「密码不正确」，但确定没输错 | 检查「值」的前后是否多了空格或换行 |
| 脚本上传返回 401 | `UPLOAD_TOKEN` 没设置，或与脚本里用的不一致 |
| 博客里的图片显示不出来 | 开了防盗链，但「放行网站」里没有博客的域名 |
| 下载回来的图片比上传时小、HDR 效果没了 | 域名所在区域开了 Polish（Pro 及以上套餐才有）。在该域名的「规则」里新建一条配置规则（Configuration Rule）：主机名等于图床域名，Polish 设为关闭 |
| 「存储」里后两个选项是灰的 | 缺少 `TG_BOT_TOKEN` 或 `TG_CHAT_ID`，或名称拼错；改完要点「部署」 |
| 备份到 Telegram 失败 | bot 不是频道管理员或没有「发布消息」权限，或 `TG_CHAT_ID` 漏了前面的 `-100` |

</details>

## 用脚本上传

```bash
curl -H "Authorization: Bearer $UPLOAD_TOKEN" \
     -H "Content-Type: image/avif" \
     --data-binary @photo.avif \
     "https://img.example.com/api/upload?name=photo.avif"
# 返回 JSON，其中 url 为图片链接；加 &naming=original 保持原文件名
```

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入密钥
npm run dev
```

## 授权

[AGPL-3.0-or-later](LICENSE)。图标来自 [Material Icons](https://github.com/google/material-design-icons)（Apache-2.0）；浏览器端编码器来自 [jSquash](https://github.com/jamsinclair/jSquash)（Apache-2.0），视频处理用 [Mediabunny](https://github.com/Vanilagy/mediabunny)（MPL-2.0），均在构建时复制，不在仓库中。
