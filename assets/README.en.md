<p align="center">
  <img src="banner.en.svg" width="100%" alt="CF ImgHub — The image host for personal blogs">
</p>

<h1 align="center">CF-ImgHub</h1>

<p align="center">
  An image host for personal blogs, running on Cloudflare Workers + R2.<br>
  Fast, compresses locally in your browser, and supports Motion Photos and HDR.
</p>

<p align="center">
  <a href="https://github.com/TG-Twilight/CF-ImgHub/fork"><img src="fork.en.svg" alt="Fork &amp; deploy"></a>
</p>

<p align="center">
  <a href="../README.md">简体中文</a> · <a href="README.zh-Hant.md">繁體中文</a> · <b>English</b>
</p>

## Features

### Fast

Images are served straight from Cloudflare's edge: cache first, then R2 on a miss. No database and no third-party storage on the read path.

### Automatic compression

Images are compressed once before upload by default (locally, in your browser): **AVIF** by default, or WebP / JPEG / PNG, or no compression; several quality levels and an optional longest-edge limit. And of course, **if the result is larger, the original is kept**.

### Motion Photos and HDR

Uploads are inspected by content to detect Motion Photos (Google Motion Photo, OPPO / OnePlus / realme O Live, including WeChat re-saves) and HDR photos (Ultra HDR / ISO 21496-1 gain maps). HDR photos, animations, SVG, ICO and videos are uploaded as-is; Motion Photos are split, compressed and reassembled in their original structure, so galleries still recognize them:

| Level | What it does |
|------|------|
| Original | Unchanged |
| Slim | Strip phone-private data, lossless |
| **Standard** (default) | Also recompress the still; HDR and the clip are kept, about half the size |
| Compact | Also convert the motion clip to SDR |
| Extreme | Also drop HDR and shrink the still to the longest edge |

The server never modifies file bytes.

## More features

- **Two roles**: uploaders need only a password and can undo uploads from the last 24 hours; admins can browse, search, bulk-delete and change settings
- **Hotlink protection**: custom allowed sites and per-image exceptions; direct visits and RSS readers are unaffected
- **Readable names**: `ImgHub-20261121-153045-k7q2.avif` by default, or keep the original name
- **Theme colors, light / dark, multiple domains, backgrounds, quick links**: all on the settings page; light or dark can be forced for everyone
- **Telegram storage (optional)**: as a backup for R2, or Telegram only for nearly unlimited storage
- **Location removal**: GPS is stripped from photos and videos before upload, leaving quality, Live Photos and HDR intact (on by default)
- **Script uploads**: call `/api/upload` with a Bearer token
- Material 3 Expressive UI, light / dark, custom color schemes, 简体中文 / 繁體中文 / English

## Screenshots

<details>
<summary>Show screenshots</summary>

**Upload**

<img src="screenshots/upload.avif" width="100%" alt="Upload">

**Admin**

<img src="screenshots/admin.avif" width="100%" alt="Admin">

**Settings**

<img src="screenshots/settings.avif" width="100%" alt="Settings">

**Sign-in**

<img src="screenshots/login.avif" width="100%" alt="Sign-in">

</details>

## Deploy

<details>
<summary>Show deployment steps</summary>

You need a Cloudflare account (the free plan is fine) and a GitHub account. To use your own domain, it must be hosted on Cloudflare.

### Step 1: fork and deploy

You will need these five secrets:

| Name | Value |
|------|------|
| `SESSION_SECRET` | A long random string used to sign sessions |
| `UPLOAD_PASSWORD` | Password for the upload page |
| `ADMIN_USER` | Admin username |
| `ADMIN_PASSWORD` | Admin password |
| `UPLOAD_TOKEN` | Token for script uploads; fill a random string even if unused |

Generate random strings with a password manager or `openssl rand -hex 32`. Names are case-sensitive; no spaces around values.

1. [Fork this repository](https://github.com/TG-Twilight/CF-ImgHub/fork) to your GitHub account
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **R2 Object Storage** → **Create bucket** and name it `cf-imghub`
3. Open **Workers & Pages** → **Create** → **Import a repository**
4. The first time, connect GitHub: click **Connect GitHub**, pick your account on the GitHub page that opens, then install and authorize the **Cloudflare Workers and Pages** app. Grant **All repositories**, or **Only select repositories** and tick your fork
5. Back in Cloudflare, select your GitHub account and your fork, then click **Next**
6. Set the project name to `cf-imghub` (it must match `name` in the repo's `wrangler.jsonc`), the build command to `npm run build`, and keep the deploy command `npx wrangler deploy`
7. Click **Deploy** and wait for the build (about 1–2 minutes)
8. Open `cf-imghub` → **Settings** → **Variables and Secrets**, **Add** each secret from the table as type **Secret**, then click **Deploy**

You now have a working `https://cf-imghub.<your-subdomain>.workers.dev` address.

**Updating later**: on your fork's GitHub page, click **Sync fork** → **Update branch**; Cloudflare redeploys automatically.

### Step 2: add your own domain (recommended)

`workers.dev` addresses cannot use the edge cache, so every request reads R2. For real use, adding your own domain is strongly recommended:

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages** → `cf-imghub`
2. Go to **Settings** → **Domains & Routes** → **Add** → **Custom domain**
3. Enter a subdomain such as `img.example.com` and confirm. DNS and the certificate are created for you within minutes

### Step 3: check it works

1. Open `https://img.example.com/`, enter the upload password, upload an image and open the returned link in a new tab
2. Open `https://img.example.com/admin` and sign in with the admin account; the image should be listed

Hotlink protection is off by default. Before turning it on, replace the sample domains under "Allowed sites" on the settings page with your blog's domain (subdomains are included), or your blog's images will be blocked.

### Step 4 (optional): add Telegram storage

Skip this if you don't need it; R2 alone works fine. Three modes:

| Mode | What it does |
|------|------|
| R2 only (default) | Fastest |
| R2 + Telegram | Served from R2 with a copy in Telegram (for disaster recovery); falls back to Telegram if a file is missing from R2 |
| Telegram only | Uses no R2 space (R2 keeps a tiny index); uncached images take 0.5–3 s to open |

(Cloudflare Workers limits single upload request bodies to 100 MB across all modes.)

1. **Create a bot**: open [@BotFather](https://t.me/BotFather) in Telegram, send `/newbot` and follow the prompts. You get a token like `123456789:AA…`. It is the bot's password; keep it private
2. **Create a channel**: a private one is fine
3. **Make the bot a channel admin**: channel info → **Administrators** → **Add Admin**, search for the bot's username, and allow at least **Post messages** and **Delete messages**
4. **Find the channel id**: open the channel in [Telegram Web](https://web.telegram.org/a/) on a computer; the number after `#` in the address bar, like `-1001234567890` (minus sign included), is the id
5. **Add the secrets**: **Workers & Pages** → `cf-imghub` → **Settings** → **Variables and Secrets** → **Add**, type **Secret**: `TG_BOT_TOKEN` (the token from step 1) and `TG_CHAT_ID` (the id from step 4), then **Deploy**
6. **Pick a mode**: open `https://img.example.com/settings` and choose where new uploads go under **Storage**
7. **Back up existing files** (optional): click **Back up** next to **Back up existing files to Telegram**. With many files Telegram rate-limits; the page waits and continues on its own, so keep it open

Switching modes only affects later uploads. Deleting an image also deletes its messages in the channel if uploaded within the last 48 hours (Telegram's Bot API only allows bots to delete messages up to 48 hours old; older image links still stop working immediately when deleted, though their channel messages must be removed manually).

### Changing passwords or settings later

Everything lives under **Workers & Pages** → `cf-imghub` → **Settings** → **Variables and Secrets**:

- **Change**: edit the entry, enter the new value, then click **Deploy**
- **Add**: click **Add**, choose type **Secret**, fill in the name and value, then click **Deploy**
- Always use **Secret** for passwords; **Text** works too but shows the value in plain sight
- Changing `SESSION_SECRET` signs everyone out; changing a password only signs out that role

Several domains: add more custom domains under the Worker's **Settings → Domains & Routes**; links follow the domain you opened the page on. List them under **Link domains** on the settings page and a globe button appears in the top bar of the upload and admin pages to switch which domain links use.

### Troubleshooting

| Symptom | Cause and fix |
|------|------|
| Your fork doesn't show up when importing | The Cloudflare GitHub app can't access it. On GitHub, go to **Settings** → **Applications** → Cloudflare Workers and Pages → **Configure** and add the repository |
| Sign-in says "This sign-in method is not configured on the server" | `SESSION_SECRET` is missing, or this page's password is (`UPLOAD_PASSWORD` for uploads; `ADMIN_USER` and `ADMIN_PASSWORD` for admin). Check the spelling under Variables and Secrets |
| "Incorrect password" although it is right | Look for stray spaces or line breaks around the value |
| Script upload returns 401 | `UPLOAD_TOKEN` is missing or differs from the one in your script |
| Images on your blog do not load | Hotlink protection is on but your blog is not in "Allowed sites" |
| Downloaded images are smaller than uploaded and HDR is gone | Polish is enabled on the zone (Pro plans and up). Under the domain's **Rules**, add a Configuration Rule matching the image host's hostname with Polish off |
| The last two **Storage** options are greyed out | `TG_BOT_TOKEN` or `TG_CHAT_ID` is missing or misspelled; click **Deploy** after fixing |
| Backing up to Telegram fails | The bot isn't a channel admin or can't post messages, or `TG_CHAT_ID` is missing the leading `-100` |

</details>

## Script uploads

```bash
curl -H "Authorization: Bearer $UPLOAD_TOKEN" \
     -H "Content-Type: image/avif" \
     --data-binary @photo.avif \
     "https://img.example.com/api/upload?name=photo.avif"
# Returns JSON with the image link in `url`; add &naming=original to keep the original name
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in the secrets
npm run dev
```

## License

[AGPL-3.0-or-later](../LICENSE). Icons from [Material Icons](https://github.com/google/material-design-icons) (Apache-2.0); in-browser encoders from [jSquash](https://github.com/jamsinclair/jSquash) (Apache-2.0) and video processing by [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0), both copied at build time, not in this repository.
