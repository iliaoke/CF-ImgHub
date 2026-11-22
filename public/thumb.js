// 缩略图：浏览器生成 WebP（短边 400），存到 R2 的 .thumb/<key>，经 /api/thumb/<key> 读取（要登录），
// 同时在浏览器本地 Cache Storage 留一份副本（使「上传记录」在后端彻底删掉原图与缩略图后仍能显示预览）。
const SHORT = 400;
const LOCAL_CACHE = 'imghub-thumbs';
let worker;
let seq = 0;
let chain = Promise.resolve(); // 单个 Worker，依次处理

export const thumbUrl = (key) => `/api/thumb/${encodeURIComponent(key)}`;

const openLocal = () => (typeof caches !== 'undefined' ? caches.open(LOCAL_CACHE).catch(() => null) : Promise.resolve(null));

/** 从图片 Blob 生成缩略图 Blob；不是图片或浏览器解不了时返回 null */
export async function makeThumb(blob) {
  if (blob.type && !blob.type.startsWith('image/')) return null;
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  worker ??= new Worker('/convert-worker.js', { type: 'module' });
  const run = chain.then(
    () =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          data.error ? reject(new Error(data.error)) : resolve(new Blob([data.buf], { type: 'image/webp' }));
        };
        worker.postMessage({ id, bitmap, format: 'webp', quality: 'small', thumb: SHORT }, [bitmap]);
      }),
  );
  chain = run.catch(() => {});
  return run;
}

export async function putThumb(key, blob) {
  const url = thumbUrl(key);
  const c = await openLocal();
  await c?.put(url, new Response(blob, { headers: { 'Content-Type': 'image/webp' } })).catch(() => {});
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/webp' }, body: blob });
  if (!r.ok) throw new Error(`thumb upload: HTTP ${r.status}`);
}

/** 从本机 Cache Storage 读取缩略图（供「上传记录」使用，完全独立于服务端文件状态） */
export async function localThumbUrl(key) {
  const c = await openLocal();
  const res = await c?.match(thumbUrl(key));
  return res ? URL.createObjectURL(await res.blob()) : null;
}

export async function dropLocalThumb(key) {
  const c = await openLocal();
  await c?.delete(thumbUrl(key)).catch(() => {});
}

export async function clearLocalThumbs() {
  if (typeof caches !== 'undefined') await caches.delete(LOCAL_CACHE).catch(() => {});
}
