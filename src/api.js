// /api/*：登录、上传、删除、列表。权限见 auth.js：upload 角色可上传、可撤回 24 小时内的上传；admin 角色全部可做
// 错误只返回代码（error 字段），由前端按语言翻译
import { pickContentType } from './mime.js';
import { allStores, BRAND, configStore, keyTime, storesFor, writeStore } from './stores.js';
import { BG_INTERVALS, isFileKey, MAX_BG, MAX_DOMAINS, MAX_LINKS, MAX_SITES, STORAGE_MODES, THEME_MODES, getSettings, normThemeColor, normBgUrl, normLink, normName, normSite, publicSettings, siteInfo, updateSettings } from './settings.js';
import { RSS_READERS } from './serve.js';
import { hasRole, identify, login, logoutCookie, sameOrigin } from './auth.js';
import { SIDECAR, TgError, isStub, realSize, tgDelete, tgPut, tgReady } from './telegram.js';

// 只对 Bearer 调用开放跨域；Cookie 会话是 SameSite=Strict，跨域请求本来就带不上
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const UNDO_WINDOW = 24 * 3600 * 1000;

export async function handleApi(request, env, ctx, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const path = url.pathname;
  const method = request.method;
  if (path === '/api/ping' && method === 'GET') return json({ ok: true });
  if (path === '/api/login' && method === 'POST') {
    const r = await login(request, env, url);
    return json(r.body, r.status, r.cookie);
  }
  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, 200, logoutCookie(url));
  // 登录页也要用：背景图与页脚链接（不含任何需要保密的设置）
  if (path === '/api/site' && method === 'GET') return json(siteInfo(await getSettings(env)));

  const role = await identify(request, env);
  if (path === '/api/session' && method === 'GET') {
    // domains：已登录时告诉前端还能用哪些域名生成链接
    const domains = role ? (await getSettings(env)).domains : undefined;
    return json({ role, user: role === 'admin' ? env.ADMIN_USER : undefined, domains });
  }
  if (!role) return json({ error: 'unauthorized' }, 401);
  if (method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'bad_origin' }, 403);

  if (path === '/api/upload' && method === 'POST') return upload(request, env, ctx, url);
  // POST /api/check {keys}：批量检查文件是否已被删除（供上传页刷新时核对本机上传记录）
  if (path === '/api/check' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const keys = Array.isArray(body?.keys) ? body.keys.filter(isFileKey).slice(0, 300) : [];
    const { goneSet } = await getSettings(env);
    const gone = (await Promise.all(keys.map(async (k) => (goneSet.has(k) || !(await keyExists(env, k)) ? k : null)))).filter(Boolean);
    return json({ gone });
  }
  if (path.startsWith('/api/file/') && method === 'DELETE') {
    let key;
    try {
      key = decodeURIComponent(path.slice('/api/file/'.length));
    } catch {
      return json({ error: 'bad_key' }, 400);
    }
    if (!isFileKey(key)) return json({ error: 'bad_key' }, 400);
    if (!hasRole(role, 'admin')) {
      if (!recent(key)) return json({ error: 'forbidden' }, 403);
      if (!(await keyExists(env, key))) return json({ error: 'not_found' }, 404);
    }
    await removeKeys(env, url, [key]);
    return json({ ok: true, key });
  }

  // 缩略图（浏览器生成的 WebP，见 public/thumb.js）：登录即可读；上传角色只能给 24 小时内的文件写
  if (path.startsWith('/api/thumb/') && (method === 'GET' || method === 'POST')) {
    let key;
    try {
      key = decodeURIComponent(path.slice('/api/thumb/'.length));
    } catch {
      return json({ error: 'bad_key' }, 400);
    }
    if (!isFileKey(key)) return json({ error: 'bad_key' }, 400);
    if (method === 'GET') return getThumb(env, key);
    if (!hasRole(role, 'admin') && !recent(key)) return json({ error: 'forbidden' }, 403);
    return putThumb(env, key, request);
  }

  if (!hasRole(role, 'admin')) return json({ error: 'forbidden' }, 403);
  if (path === '/api/list' && method === 'GET') return list(env, url);
  if (path === '/api/stats' && method === 'GET') return stats(env);
  if (path === '/api/settings' && method === 'GET') return json(settingsOut(env, await getSettings(env)));
  if (path === '/api/settings' && method === 'POST') {
    // {name?: string, hotlink?, rss?: boolean, allow?, domains?: string[], bg?: {urls?, login?, upload?, interval?}, links?: [{name, url}], theme?: {color?, mode?, logo?, glow?}}，至少给一项；bg、theme 为局部合并
    const body = await request.json().catch(() => null);
    const next = {};
    for (const f of ['hotlink', 'rss']) {
      if (!(f in (body ?? {}))) continue;
      if (typeof body[f] !== 'boolean') return json({ error: 'bad_request' }, 400);
      next[f] = body[f];
    }
    if ('name' in (body ?? {})) {
      const name = normName(body.name);
      if (name === null) return json({ error: 'bad_request' }, 400);
      next.name = name;
    }
    if ('storage' in (body ?? {})) {
      if (!STORAGE_MODES.includes(body.storage)) return json({ error: 'bad_request' }, 400);
      if (body.storage !== 'r2' && !tgReady(env)) return json({ error: 'tg_not_configured' }, 400);
      next.storage = body.storage;
    }
    if ('allow' in (body ?? {})) {
      if (!Array.isArray(body.allow) || body.allow.length > MAX_SITES) return json({ error: 'bad_request' }, 400);
      const sites = body.allow.map(normSite);
      const bad = body.allow.find((_, i) => !sites[i]);
      if (bad !== undefined) return json({ error: 'bad_site', site: String(bad) }, 400);
      next.allow = sites;
    }
    if ('domains' in (body ?? {})) {
      if (!Array.isArray(body.domains) || body.domains.length > MAX_DOMAINS) return json({ error: 'bad_request' }, 400);
      const hosts = body.domains.map(normSite);
      const bad = body.domains.find((_, i) => !hosts[i]);
      if (bad !== undefined) return json({ error: 'bad_site', site: String(bad) }, 400);
      next.domains = hosts;
    }
    if ('links' in (body ?? {})) {
      if (!Array.isArray(body.links) || body.links.length > MAX_LINKS) return json({ error: 'bad_request' }, 400);
      const links = body.links.map(normLink);
      const bad = body.links.find((_, i) => !links[i]);
      if (bad !== undefined) return json({ error: 'bad_link', site: String(bad?.url ?? '') }, 400);
      next.links = links;
    }
    let bgPatch;
    if ('bg' in (body ?? {})) {
      const b = body.bg;
      if (!b || typeof b !== 'object') return json({ error: 'bad_request' }, 400);
      if ('urls' in b) {
        if (!Array.isArray(b.urls) || b.urls.length > MAX_BG) return json({ error: 'bad_request' }, 400);
        const urls = b.urls.map(normBgUrl);
        const bad = b.urls.find((_, i) => !urls[i]);
        if (bad !== undefined) return json({ error: 'bad_url', site: String(bad) }, 400);
        b.urls = urls;
      }
      delete b.keys;
      if (('login' in b && typeof b.login !== 'boolean') || ('upload' in b && typeof b.upload !== 'boolean')) return json({ error: 'bad_request' }, 400);
      if ('interval' in b && !BG_INTERVALS.includes(b.interval)) return json({ error: 'bad_request' }, 400);
      bgPatch = b;
    }
    let themePatch;
    if ('theme' in (body ?? {})) {
      const th = body.theme;
      if (!th || typeof th !== 'object') return json({ error: 'bad_request' }, 400);
      themePatch = {};
      if ('color' in th) {
        if (!normThemeColor(th.color)) return json({ error: 'bad_request' }, 400);
        themePatch.color = normThemeColor(th.color);
      }
      if ('mode' in th) {
        if (!THEME_MODES.includes(th.mode)) return json({ error: 'bad_request' }, 400);
        themePatch.mode = th.mode;
      }
      for (const f of ['logo', 'glow']) {
        if (!(f in th)) continue;
        if (typeof th[f] !== 'boolean') return json({ error: 'bad_request' }, 400);
        themePatch[f] = th[f];
      }
      if (!Object.keys(themePatch).length) return json({ error: 'bad_request' }, 400);
    }
    if (!Object.keys(next).length && !bgPatch && !themePatch) return json({ error: 'bad_request' }, 400);
    const saved = await updateSettings(env, (cur) => {
      const merged = { ...cur, ...next };
      if (bgPatch) merged.bg = { ...cur.bg, ...bgPatch };
      if (themePatch) merged.theme = { ...cur.theme, ...themePatch };
      return merged;
    });
    return json(settingsOut(env, saved));
  }
  // POST /api/exempt {keys, on}：单张防盗链开关。on=true 表示这几张允许外链
  if (path === '/api/exempt' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const keys = Array.isArray(body?.keys) ? body.keys.filter(isFileKey) : [];
    if (!keys.length || keys.length > 1000 || typeof body.on !== 'boolean') return json({ error: 'bad_request' }, 400);
    const saved = await updateSettings(env, (cur) => {
      const set = new Set(cur.exempt);
      for (const k of keys) body.on ? set.add(k) : set.delete(k);
      return { ...cur, exempt: [...set] };
    });
    return json(settingsOut(env, saved));
  }
  if (path === '/api/delete' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const keys = Array.isArray(body?.keys) ? body.keys.filter(isFileKey) : [];
    if (!keys.length || keys.length > 100) return json({ error: 'bad_key' }, 400);
    await removeKeys(env, url, keys);
    return json({ ok: true, deleted: keys.length });
  }
  if (path === '/api/tg/status' && method === 'GET') return tgStatus(env);
  // POST /api/tg/backup {keys}：把已在 R2 的文件补备份到 Telegram（一次最多 5 个，前端循环调用）
  if (path === '/api/tg/backup' && method === 'POST') {
    if (!tgReady(env)) return json({ error: 'tg_not_configured' }, 400);
    const body = await request.json().catch(() => null);
    const keys = Array.isArray(body?.keys) ? body.keys.filter(isFileKey) : [];
    if (!keys.length || keys.length > 5) return json({ error: 'bad_key' }, 400);
    const results = [];
    for (const key of keys) {
      try {
        results.push({ key, status: await backupKey(env, key) });
      } catch (err) {
        console.warn(JSON.stringify({ event: 'tg-backup-failed', key, error: err.message }));
        // 触发 Telegram 限流就停下，告诉前端等多久
        if (err instanceof TgError && err.retryAfter) return json({ results, retryAfter: err.retryAfter });
        results.push({ key, status: 'failed' });
      }
    }
    return json({ results });
  }
  return json({ error: 'not_found' }, 404);
}

const settingsOut = (env, s) => ({ ...publicSettings(s), rssReaders: RSS_READERS, tgReady: tgReady(env) });

// 实际使用的存储方式：没配置 Telegram 时一律只存 R2
async function storageMode(env) {
  return tgReady(env) ? (await getSettings(env)).storage : 'r2';
}

// 把 R2 里的 key 备份到 Telegram：清单连同原对象的 httpMetadata 存到主桶 .tg/<key>
// 返回 done / exists（已有备份）/ tg（本来就只存 Telegram）/ missing
async function backupKey(env, key) {
  const main = configStore(env).bucket;
  if (await main.head(SIDECAR + key)) return 'exists';
  for (const s of storesFor(env, key)) {
    const obj = await s.bucket.get(key);
    if (!obj) continue;
    if (isStub(obj)) {
      await obj.body.cancel();
      return 'tg';
    }
    const manifest = await tgPut(env, key, obj.body, obj.size);
    await main.put(SIDECAR + key, JSON.stringify(manifest), { httpMetadata: obj.httpMetadata });
    return 'done';
  }
  return 'missing';
}

// GET /api/tg/status：已备份数、只存 Telegram 的数量、还没备份的 key（供设置页「补备份」）
async function tgStatus(env) {
  const backed = new Set();
  await listAll(configStore(env).bucket, { prefix: SIDECAR }, (o) => backed.add(o.key.slice(SIDECAR.length)));
  const pending = [];
  let tgOnly = 0;
  for (const s of allStores(env)) {
    await listAll(s.bucket, { include: ['customMetadata'] }, (o) => {
      if (o.key.startsWith('.')) return;
      if (isStub(o)) tgOnly++;
      else if (!backed.has(o.key)) pending.push(o.key);
    });
  }
  return json({ ready: tgReady(env), storage: (await getSettings(env)).storage, backed: backed.size, tgOnly, pending });
}

async function listAll(bucket, opts, fn) {
  let cursor;
  let pages = 0;
  do {
    const res = await bucket.list({ ...opts, limit: 1000, cursor });
    res.objects.forEach(fn);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor && ++pages < 50);
}

// upload 角色只能撤回 24 小时内上传的文件（按 key 里的上传时间判断）
function recent(key) {
  const ts = keyTime(key);
  return Number.isFinite(ts) && Date.now() - ts < UNDO_WINDOW && ts <= Date.now() + 60000;
}

// POST /api/upload?name=<原文件名>&naming=std|original，请求体就是文件本身（不用 multipart，直接流式写进 R2）
// naming 默认 std（规范命名）；original 为「13 位时间戳_原文件名」，与旧图床格式相同
async function upload(request, env, ctx, url) {
  const length = Number(request.headers.get('Content-Length'));
  if (!request.body || !Number.isFinite(length) || length <= 0) return json({ error: 'empty_body' }, 411);

  const name = sanitizeName(url.searchParams.get('name') || 'file');
  const contentType = pickContentType(name, request.headers.get('Content-Type'));
  const store = writeStore(env);
  const original = url.searchParams.get('naming') === 'original';

  // 冲突概率极低（同毫秒同名 / 同秒且 20 位随机码相同），仍然检查一下；已删除名单里的 key 也不复用（读路径会挡掉）
  const { goneSet } = await getSettings(env);
  const taken = async (k) => goneSet.has(k) || Boolean(await store.bucket.head(k));
  let ts = Date.now();
  let key = original ? `${ts}_${name}` : stdName(ts, name);
  for (let i = 0; i < 5 && (await taken(key)); i++) key = original ? `${++ts}_${name}` : stdName(ts, name);

  const fileName = original ? name : key;
  const httpMetadata = { contentType, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` };
  const custom = original ? {} : { name };
  const mode = await storageMode(env);
  let size;
  if (mode === 'tg') {
    // 只存 Telegram：文件流式发到频道，R2 里放占位对象（正文是清单）
    let manifest;
    try {
      manifest = await tgPut(env, key, request.body, length);
    } catch (err) {
      console.warn(JSON.stringify({ event: 'tg-upload-failed', key, error: err.message }));
      return json({ error: 'tg_failed' }, 502);
    }
    await store.bucket.put(key, JSON.stringify(manifest), { httpMetadata, customMetadata: { ...custom, tg: '1', size: String(length) } });
    size = length;
  } else {
    const obj = await store.bucket.put(key, request.body, { httpMetadata, customMetadata: original ? undefined : custom });
    size = obj.size;
    // 备份在回应之后做，不拖慢上传；失败的可以在设置页补备份
    if (mode === 'r2+tg') {
      ctx.waitUntil(backupKey(env, key).catch((err) => console.warn(JSON.stringify({ event: 'tg-backup-failed', key, error: err.message }))));
    }
  }

  // 从哪个域名进来就用哪个域名；要换成其他绑定域名由前端改写（见 ui.js 的 linkOf）
  return json({ key, url: `${url.origin}/file/${encodeURIComponent(key)}`, size, contentType, store: mode === 'tg' ? 'tg' : store.binding });
}

// 规范名：ImgHub-YYYYMMDD-HHmmss-xxxx.ext，时间按 UTC+8；随机码用去掉 0/o/1/l 的 32 个字符，防同秒冲突、也防按时间猜链接
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
export function stdName(ts, name) {
  const d = new Date(ts + 8 * 3600 * 1000).toISOString(); // 2026-11-21T15:30:45.123Z（已是 UTC+8 的钟面）
  const stamp = `${d.slice(0, 10).replaceAll('-', '')}-${d.slice(11, 19).replaceAll(':', '')}`;
  const rand = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => ALPHABET[b & 31]).join('');
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  return `${BRAND}-${stamp}-${rand}${ext ? `.${ext}` : ''}`;
}

export const THUMB = '.thumb/';
const THUMB_MAX = 512 * 1024;

// 缩略图与原图放在同一个桶（列表时顺带列出，管理页据此知道哪些已有缩略图）
async function getThumb(env, key) {
  for (const s of storesFor(env, key)) {
    const obj = await s.bucket.get(THUMB + key);
    if (!obj) continue;
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(obj.size),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: obj.httpEtag,
      },
    });
  }
  return json({ error: 'not_found' }, 404);
}

async function putThumb(env, key, request) {
  const length = Number(request.headers.get('Content-Length'));
  if (!(length > 12 && length <= THUMB_MAX)) return json({ error: 'bad_request' }, 400);
  const buf = new Uint8Array(await request.arrayBuffer());
  const ascii = (a, b) => String.fromCharCode(...buf.subarray(a, b));
  if (buf.length > THUMB_MAX || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return json({ error: 'bad_request' }, 400);
  for (const s of storesFor(env, key)) {
    if (!(await s.bucket.head(key))) continue;
    await s.bucket.put(THUMB + key, buf, { httpMetadata: { contentType: 'image/webp' } });
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}

// GET /api/list?cursor=&limit=：遍历所有存储桶；跳过开头的内部对象（.tg/ 与 .thumb/）直到攒够真实文件或读完
async function list(env, url) {
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);
  const prefix = url.searchParams.get('prefix') || undefined;
  const stores = allStores(env);
  const rawCursor = url.searchParams.get('cursor') || '';
  let storeIdx = 0;
  let innerCursor;
  if (rawCursor) {
    const m = /^(\d+):(.*)$/.exec(rawCursor);
    if (m && Number(m[1]) < stores.length) {
      storeIdx = Number(m[1]);
      innerCursor = m[2] || undefined;
    } else {
      innerCursor = rawCursor;
    }
  }

  const thumbs = [];
  const backed = [];
  const items = [];
  let pages = 0;

  while (storeIdx < stores.length && items.length < limit && pages < 10) {
    pages++;
    const res = await stores[storeIdx].bucket.list({
      limit,
      cursor: innerCursor,
      prefix,
      include: ['httpMetadata', 'customMetadata'],
    });
    for (const o of res.objects) {
      if (o.key.startsWith(THUMB)) thumbs.push(o.key.slice(THUMB.length));
      else if (o.key.startsWith(SIDECAR)) backed.push(o.key.slice(SIDECAR.length));
      else if (!o.key.startsWith('.')) {
        items.push({
          key: o.key,
          name: o.customMetadata?.name,
          url: `${url.origin}/file/${encodeURIComponent(o.key)}`,
          size: realSize(o),
          tg: isStub(o) || undefined,
          contentType: o.httpMetadata?.contentType,
          uploaded: o.uploaded,
        });
      }
    }
    if (res.truncated) {
      innerCursor = res.cursor;
    } else {
      storeIdx++;
      innerCursor = undefined;
    }
  }

  const nextCursor =
    storeIdx < stores.length && (innerCursor || storeIdx > 0)
      ? stores.length > 1
        ? `${storeIdx}:${innerCursor || ''}`
        : innerCursor || null
      : null;

  return json({
    // 「.」开头的内部对象排在最前面；其中 .thumb/ 告诉前端哪些文件已有缩略图，.tg/ 告诉前端哪些已有 Telegram 备份
    thumbs,
    backed,
    items,
    cursor: nextCursor,
  });
}

async function keyExists(env, key) {
  for (const s of storesFor(env, key)) {
    if (await s.bucket.head(key)) return true;
  }
  return Boolean(await configStore(env).bucket.head(SIDECAR + key));
}

// 从所有桶删除。Cache API 只能清当前机房的缓存，其他机房要等过期或在面板清除
async function removeKeys(env, url, keys) {
  const stores = allStores(env);
  const main = configStore(env).bucket;
  // Telegram 里的消息（备份清单与占位对象里记着 message_id）也删掉；删不掉不影响 R2 的删除
  const msgs = [];
  const collect = async (obj) => obj && msgs.push(...(await obj.json()).chunks.map((c) => c.msg));
  await Promise.all(
    keys.map(async (key) => {
      await collect(await main.get(SIDECAR + key));
      for (const s of stores) if (isStub(await s.bucket.head(key))) await collect(await s.bucket.get(key));
    }),
  );
  await Promise.all([
    ...stores.map((s) => s.bucket.delete([...keys, ...keys.map((k) => THUMB + k)])),
    main.delete(keys.map((k) => SIDECAR + k)),
  ]);
  if (msgs.length && tgReady(env)) {
    await tgDelete(env, msgs).catch((err) => console.warn(JSON.stringify({ event: 'tg-delete-failed', error: err.message })));
  }
  // 记进已删除名单（其他机房的缓存由读路径挡掉），顺手从防盗链豁免名单里拿掉（背景图是自由填写的地址，不跟着删）
  const gone = new Set(keys);
  const now = Date.now();
  const saved = await updateSettings(env, (cur) => ({
    ...cur,
    exempt: cur.exempt.filter((k) => !gone.has(k)),
    gone: [...keys.filter((k) => !k.startsWith('.')).map((k) => [k, now]), ...cur.gone],
  }));
  const origins = [...new Set([url.origin, ...saved.domains.map((d) => `https://${d}`)])];
  await Promise.all(
    keys.flatMap((key) => {
      const path = `/file/${encodeURIComponent(key)}`;
      return origins.map((o) => caches.default.delete(new Request(o + path)));
    }),
  );
}

// GET /api/stats：遍历所有存储桶统计真实文件数量和总大小（最多统计 2 万个真实文件，内部 . 对象不占额度）
async function stats(env) {
  const MAX_FILES = 20000;
  let count = 0;
  let bytes = 0;
  let partial = false;
  for (const store of allStores(env)) {
    let cursor;
    let pages = 0;
    do {
      const res = await store.bucket.list({ limit: 1000, cursor, include: ['customMetadata'] });
      for (const o of res.objects) {
        if (o.key.startsWith('.')) continue;
        count++;
        bytes += realSize(o);
      }
      cursor = res.truncated ? res.cursor : undefined;
      if (count >= MAX_FILES && cursor) {
        partial = true;
        break;
      }
    } while (cursor && ++pages < 100);
    if (cursor) partial = true;
    if (partial) break;
  }
  return json({ count, bytes, partial });
}

// 文件名：保留中文等 Unicode，去掉路径分隔符、URL 特殊字符和控制字符，空白换成下划线
export function sanitizeName(raw) {
  let name = raw
    .normalize('NFC')
    .replace(/[\\/?#%&*:"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '');
  if ([...name].length > 120) name = [...name].slice(-120).join('');
  return name || 'file';
}

function json(data, status = 200, cookie) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}
