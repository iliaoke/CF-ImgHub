// 上传页：登录 → 选文件 → 判断是否豁免 → 浏览器内转码 → 上传 → 记录
import { t } from './i18n.js';
import { parseLive, slimLive, transcodeVideo } from './live.js';
import { stripGps } from './gps.js';
import { makeThumb, putThumb, thumbUrl } from './thumb.js';
import { $, api, canDo, confirmBox, copyText, errText, gate, icon, initLang, logout, morph, setShape, size, snack, snippet, topbarShadow, when, wavy } from './ui.js';

const store = {
  get: (k, d) => localStorage.getItem(`imghub.${k}`) ?? d,
  set: (k, v) => localStorage.setItem(`imghub.${k}`, v),
};
localStorage.removeItem('imghub.token'); // 旧版本存的上传密钥，已改用登录会话

const opts = {
  mode: store.get('mode', 'auto'),
  format: store.get('format', 'avif'),
  quality: store.get('quality', 'balanced'),
  edge: store.get('edge', '0'),
  naming: store.get('naming', 'std'), // 默认按图床规范命名
  live: store.get('live', '2'), // 实况照片：0 原样 / 1 精简 / 2 标准 / 3 紧凑 / 4 极致
  gps: store.get('gps', '1'), // 去除定位（默认开）
};
// 实况主图的 JPEG 质量（原档约 q97，q90 时肉眼无差）
const LIVE_Q = { high: 0.95, balanced: 0.9, small: 0.85 };
const UNDO_WINDOW = 24 * 3600 * 1000;
let session = { role: null };

initLang();
topbarShadow();
for (const el of document.querySelectorAll('[data-shape]')) setShape(el, el.dataset.shape);
document.addEventListener('langchange', renderHistory);
$('#logout').onclick = logout;

// ---------- 选项 ----------
const GROUPS = ['mode', 'format', 'quality', 'edge', 'naming', 'live'];
for (const name of GROUPS) {
  $(`#${name}`).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    opts[name] = b.dataset.v;
    store.set(name, b.dataset.v);
    syncOpts();
  });
}
function syncOpts() {
  for (const name of GROUPS) {
    for (const b of $(`#${name}`).children) {
      const on = b.dataset.v === opts[name];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
  }
  $('#formatField').hidden = opts.mode !== 'custom';
  const lossy = opts.mode === 'auto' || opts.format !== 'png';
  $('#qualityField').hidden = opts.mode === 'original' || (!lossy && opts.live < '2');
  $('#liveField').hidden = opts.mode === 'original';
  $('#liveHint').dataset.i18n = `lvHint${opts.live}`;
  $('#liveHint').textContent = t($('#liveHint').dataset.i18n);
  $('#edgeField').hidden = opts.mode === 'original';
  $('#namingHint').dataset.i18n = opts.naming === 'std' ? 'namingHint' : 'origHint';
  $('#namingHint').textContent = t($('#namingHint').dataset.i18n);
}
syncOpts();

// 去除定位：放在默认折叠的「更多选项」里
const gpsToggle = $('#gpsRow .toggle');
const syncGps = () => gpsToggle.setAttribute('aria-checked', String(opts.gps === '1'));
$('#gpsRow').onclick = () => {
  opts.gps = opts.gps === '1' ? '0' : '1';
  store.set('gps', opts.gps);
  syncGps();
};
syncGps();

// ---------- 拖放区：形状一直缓慢变形，拖进来时加速 ----------
const drop = $('#drop');
const dropShape = morph($('#dropEmblem'), ['cookie9', 'clover4', 'burst12', 'cookie7', 'sunny8'], { step: 2400, spin: 30000 });
let dragDepth = 0;
const setOver = (on) => {
  drop.classList.toggle('over', on);
  dropShape.speed(on ? 4 : 1);
};
$('#files').onchange = (e) => {
  if (e.target.files?.length) addFiles(e.target.files);
  e.target.value = '';
};
// 整个窗口都接受拖放，拖入时高亮上传区
addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  setOver(true);
});
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    setOver(false);
  }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  setOver(false);
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

// ---------- 转码线程池 ----------
const POOL = Math.min(3, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
const idle = [];
const waiters = [];
let seq = 0;
let created = 0;
async function getWorker() {
  if (idle.length) return idle.pop();
  if (created < POOL) {
    created++;
    return new Worker('/convert-worker.js', { type: 'module' });
  }
  return new Promise((r) => waiters.push(r));
}
function releaseWorker(w) {
  const next = waiters.shift();
  next ? next(w) : idle.push(w);
}
async function convert(bitmap, format, extra = {}) {
  const w = await getWorker();
  try {
    return await new Promise((resolve, reject) => {
      const id = ++seq;
      w.onmessage = ({ data }) => {
        if (data.id !== id) return;
        data.error ? reject(new Error(data.error)) : resolve(data);
      };
      w.postMessage({ id, bitmap, format, quality: opts.quality, maxEdge: Number(opts.edge), ...extra }, [bitmap]);
    });
  } finally {
    releaseWorker(w);
  }
}

// ---------- 判断是否原样上传 ----------
const IMAGE_EXT = /\.(jpe?g|jfif|png|apng|gif|webp|avif|jxl|heic|heif|ico|cur|svg|bmp|tiff?)$/i;
async function keepReason(file) {
  if (opts.mode === 'original') return 'rOriginal';
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (!type.startsWith('image/') && !IMAGE_EXT.test(name)) return 'rVideo';
  if (/\.(ico|cur)$/.test(name) || /icon/.test(type)) return 'rIco';
  if (/\.svg$/.test(name) || type === 'image/svg+xml') return 'rSvg';
  if (/\.gif$/.test(name) || type === 'image/gif') return 'rGif';

  // 读前 512KB 找特征：动图标记、HDR 增益图、实况照片 XMP
  const bytes = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  // latin1 解码只用来搜 ASCII 特征（0x80–0x9F 会被映射成别的字符），魔数用原始字节判断
  const head = new TextDecoder('latin1').decode(bytes);
  const isPng = bytes[0] === 0x89 && head.slice(1, 4) === 'PNG';
  const isWebp = head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  const isIsoBmff = head.slice(4, 8) === 'ftyp';
  const isAvif = isIsoBmff && /avif|avis/.test(head.slice(8, 40));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isJxl = (bytes[0] === 0xff && bytes[1] === 0x0a) || head.slice(4, 8) === 'JXL ';
  const hdrRe = /hdrgm|HDRGainMap|GainMap|iso:ts:21496|21496-1/;

  if (isPng && head.includes('acTL') && head.indexOf('acTL') < head.indexOf('IDAT')) return 'rAnimated';
  if (isWebp && head.includes('ANIM')) return 'rAnimated';
  if (isIsoBmff && head.slice(8, 40).includes('avis')) return 'rAnimated';
  if (isJpeg && /MotionPhoto|MicroVideo|OpCamera:VideoLength/.test(head)) return 'rLive';
  if (isJpeg && hdrRe.test(head)) return 'rHdr';
  // 部分 Ultra HDR / ISO 21496-1 静态 JPEG 的增益图元数据写在文件尾部的副图头部（主图只有 MPF）
  if (isJpeg && head.includes('MPF\0') && file.size > 512 * 1024) {
    const tail = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(-512 * 1024).arrayBuffer()));
    if (hdrRe.test(tail)) return 'rHdr';
  }
  if (isIsoBmff && head.includes('tmap')) return 'rHdr';
  if (opts.mode === 'auto' && (isAvif || isWebp || isJxl)) {
    // 设了最长边时，先交给解码器看尺寸是否超标；未超标再按 rEfficient 原样上传
    return opts.edge === '0' ? 'rEfficient' : 'rCheckEdge';
  }
  return null;
}

// ---------- 处理队列 ----------
// 同时处理的文件数有上限：一次拖进几十张实况照片时，别把它们同时读进内存、同时上传
const MAX_ACTIVE = 3;
let active = 0;
const pending = [];
const acquire = () => (active < MAX_ACTIVE ? (active++, Promise.resolve()) : new Promise((r) => pending.push(r)));
const release = () => (pending.length ? pending.shift()() : active--);

let queued = 0;
async function addFiles(list) {
  if (!list?.length) return;
  $('#queueSec').hidden = false;
  await Promise.all([...list].map(processFile));
}

async function processFile(file) {
  const ui = itemView({ name: file.name, thumb: !file.type || file.type.startsWith('image/') ? URL.createObjectURL(file) : null, type: file.type });
  $('#queue').prepend(ui.el);
  $('#queueCount').textContent = ++queued;
  await acquire();
  try {
    let blob = file;
    let name = file.name;
    let reason = await keepReason(file);
    const chips = [];

    if (reason === 'rLive' && opts.live !== '0') {
      ui.status(t('sConverting'), null);
      const r = await liveSlim(file, ui);
      reason = r.reason ?? null;
      if (!reason) {
        blob = r.blob;
        chips.push(...r.chips);
      }
    } else if (!reason || reason === 'rCheckEdge') {
      const checkOnly = reason === 'rCheckEdge';
      reason = null;
      ui.status(t('sConverting'), null);
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        reason = checkOnly ? 'rEfficient' : 'rUndecodable';
      }
      if (bitmap && checkOnly && Math.max(bitmap.width, bitmap.height) <= Number(opts.edge)) {
        bitmap.close();
        bitmap = null;
        reason = 'rEfficient';
      }
      if (bitmap) {
        const format = opts.mode === 'auto' ? 'avif' : opts.format;
        const out = await convert(bitmap, format);
        const converted = new Blob([out.buf], { type: `image/${format}` });
        // 压完变大时一律自动用原图
        if (converted.size >= file.size) {
          reason = 'rLarger';
        } else {
          blob = converted;
          name = file.name.replace(/\.[^.]+$/, '') + `.${format === 'jpeg' ? 'jpg' : format}`;
          const saved = Math.round((1 - blob.size / file.size) * 100);
          chips.push(['primary', format.toUpperCase()], ['', `${size(file.size)} → ${size(blob.size)}`]);
          if (saved > 0) chips.push(['success', `−${saved}%`]);
          chips.push(['', `${out.width}×${out.height}`]);
        }
      }
    }
    if (reason) {
      chips.push([/^rLive/.test(reason) ? 'live' : reason === 'rHdr' ? 'tertiary' : 'primary', `${t('keptOriginal')} · ${t(reason)}`], ['', size(file.size)]);
    }

    if (opts.gps === '1') {
      const clean = await stripGps(blob);
      if (clean !== blob) {
        blob = clean;
        chips.push(['', t('gpsRemoved')]);
      }
    }

    const res = await upload(blob, name, (p) => ui.status(t('sUploading', { p }), p));
    // 管理页 / 上传记录用的缩略图：先传好再记录，免得上传记录先去拉原图；失败不影响上传结果
    await makeThumb(blob).then((th) => th && putThumb(res.key, th)).catch((err) => console.warn('thumb failed', err));
    const entry = { key: res.key, url: res.url, name, size: res.size, type: res.contentType, time: Date.now() };
    addHistory(entry);
    ui.done(entry, chips);
  } catch (err) {
    ui.fail(err.message);
  } finally {
    release();
  }
}

// 实况照片分级瘦身：主图在 Worker 里重编码，其余在 live.js 里拆装
async function liveSlim(file, ui) {
  const live = parseLive(await file.arrayBuffer());
  if (!live) return { reason: 'rLiveUnknown' };
  const level = Number(opts.live);
  const out = await slimLive(live, level, async (src, dropHdr) => {
    // 不做色彩转换、不按 EXIF 旋转：像素原样重编码，ICC 与 EXIF 方向沿用原来的段
    const bitmap = await createImageBitmap(src, { colorSpaceConversion: 'none', imageOrientation: 'none' }).catch(() => null);
    if (!bitmap) return null;
    const r = await convert(bitmap, 'jpeg', { q: LIVE_Q[opts.quality], maxEdge: dropHdr ? Number(opts.edge) : 0 });
    return new Uint8Array(r.buf);
  }, async (video) => {
    ui.status(t('sVideo', { p: 0 }), 0);
    try {
      return await transcodeVideo(video, opts.quality, (p) => ui.status(t('sVideo', { p: Math.round(p * 100) }), Math.round(p * 100)));
    } catch (err) {
      console.warn('video transcode failed', err);
      return { skip: 'error' };
    }
  });
  // 没东西可去（例如微信转存版没有私有尾部）时原样上传
  if (out.bytes.length >= file.size) return { reason: out.bytes.length === file.size ? 'rLiveNoop' : 'rLarger' };
  const chips = [['live', `${t('rLive')} · ${t(`lv${level}`)}`]];
  if (live.gainmap && !out.droppedHdr) chips.push(['tertiary', 'HDR']);
  if (out.videoDone) chips.push(['primary', t('vSdr')]);
  else if (out.videoSkip) chips.push(['', t(`vSkip_${out.videoSkip}`)]);
  chips.push(['', `${size(file.size)} → ${size(out.bytes.length)}`]);
  const saved = Math.round((1 - out.bytes.length / file.size) * 100);
  if (saved > 0) chips.push(['success', `−${saved}%`]);
  return { blob: new Blob([out.bytes], { type: 'image/jpeg' }), chips };
}

// XHR 才有上传进度；会话 Cookie 同源自动带上
function upload(blob, name, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?name=${encodeURIComponent(name)}&naming=${opts.naming}`);
    if (blob.type) xhr.setRequestHeader('Content-Type', blob.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error(t('e_network')));
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200) return resolve(body);
      if (xhr.status === 401) expired();
      reject(new Error(errText({ status: xhr.status, body })));
    };
    xhr.send(blob);
  });
}

let reauth = null;
function expired() {
  if (reauth) return;
  snack(t('sessionExpired'), { error: true });
  reauth = gate('upload', { bg: 'upload' }).then((s) => {
    session = s;
    reauth = null;
  });
}

// ---------- 列表项 ----------
function itemView({ name, thumb, type, fallback }) {
  const el = document.createElement('li');
  el.innerHTML = '<div class="thumb"></div><div class="item-body"><div class="item-name"></div><div class="item-meta"></div></div><div class="acts"></div>';
  const th = $('.thumb', el);
  if (thumb && (!type || type.startsWith('image/'))) {
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = thumb;
    // 本机文件的预览用完就释放（已显示的画面不受影响）
    const free = () => thumb.startsWith('blob:') && URL.revokeObjectURL(thumb);
    img.onload = free;
    img.onerror = () => {
      free();
      // 没有缩略图（旧记录）时退回原图
      if (fallback && img.src !== new URL(fallback, location.href).href) img.src = fallback;
      else img.replaceWith(icon('file'));
    };
    th.append(img);
  } else {
    th.append(icon(type?.startsWith('video/') ? 'movie' : 'file'));
  }
  $('.item-name', el).textContent = name;
  const meta = $('.item-meta', el);
  const body = $('.item-body', el);
  const bar = wavy();
  meta.textContent = t('sQueued');
  body.append(bar.el);

  return {
    el,
    status(s, p) {
      meta.textContent = s;
      bar.set(p);
    },
    fail(e) {
      bar.el.remove();
      meta.replaceChildren(icon('error', 'sm'), document.createTextNode(t('sFailed', { e })));
      meta.className = 'item-meta bad';
    },
    done(entry, chips = []) {
      bar.el.remove();
      el.dataset.key = entry.key;
      $('.item-name', el).textContent = entry.name;
      $('.item-name', el).title = entry.key;
      meta.replaceChildren(...chips.map(([cls, text]) => Object.assign(document.createElement('span'), { className: `chip ${cls}`, textContent: text })));
      meta.className = 'item-meta';
      fillActions($('.acts', el), entry, el);
    },
  };
}

function fillActions(box, entry, el) {
  const btn = (name, tip, fn) => {
    const b = document.createElement('button');
    b.className = 'btn icon state';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.append(icon(name));
    b.onclick = () => fn(b);
    box.append(b);
    return b;
  };
  btn('link', t('copyUrl'), (b) => copyText(snippet('url', entry), b));
  btn('md', t('copyMd'), (b) => copyText(snippet('md', entry), b));
  btn('code', t('copyHtml'), (b) => copyText(snippet('html', entry), b));
  // 上传角色只能撤回 24 小时内的文件，管理员不限
  if (canDo(session.role, 'admin') || Date.now() - entry.time < UNDO_WINDOW) {
    btn('delete', t('del'), async () => {
      if (!(await confirmBox({ title: t('confirmDelTitle'), text: t('confirmDel', { name: entry.name }) }))) return;
      const r = await api(`/api/file/${encodeURIComponent(entry.key)}`, { method: 'DELETE' });
      if (!r.ok) {
        if (r.status === 401) expired();
        return snack(errText(r), { error: true });
      }
      snack(t('deleted'));
      removeHistory(entry.key);
      for (const qEl of $('#queue').querySelectorAll('li')) {
        if (qEl.dataset.key === entry.key) {
          qEl.classList.add('out');
          setTimeout(() => {
            qEl.remove();
            queued = $('#queue').childElementCount;
            $('#queueCount').textContent = queued;
            if (!queued) $('#queueSec').hidden = true;
          }, 300);
        }
      }
    });
  }
}

// ---------- 上传记录（只存本机） ----------
const loadHistory = () => JSON.parse(store.get('history', '[]'));
const saveHistory = (h) => store.set('history', JSON.stringify(h.slice(0, 300)));
function addHistory(entry) {
  saveHistory([entry, ...loadHistory()]);
  renderHistory();
}
function removeHistory(key) {
  saveHistory(loadHistory().filter((e) => e.key !== key));
  renderHistory();
}
function renderHistory() {
  const ul = $('#history');
  const list = loadHistory();
  ul.replaceChildren();
  $('#historyEmpty').hidden = list.length > 0;
  $('#clearHistory').hidden = !list.length;
  for (const entry of list) {
    const ui = itemView({ name: entry.name, thumb: thumbUrl(entry.key), fallback: entry.url, type: entry.type });
    ui.done(entry, [['', size(entry.size)], ['', when(entry.time)]]);
    ul.append(ui.el);
  }
}
$('#clearHistory').onclick = () => {
  saveHistory([]);
  renderHistory();
};

// ---------- 启动：先过登录闸门 ----------
session = await gate('upload', { bg: 'upload' });
renderHistory();
