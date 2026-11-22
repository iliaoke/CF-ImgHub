// 实况照片（Motion Photo，JPEG + 尾随 MP4）在浏览器里分级瘦身
// 支持：OPlus O Live（OPPO / realme / 一加，含微信转存后的版本）与 Google Motion Photo（Container:Directory 或旧版 MicroVideoOffset）
// 文件布局：主图 JPEG ‖ [增益图 JPEG] ‖ 视频 MP4 ‖ [OPlus 私有尾部]
// 级别：1 精简 = 去私有尾部与高通调试段（画质无损）
//       2 标准 = 以上 + 主图重新编码（保留 EXIF / XMP / ICC，HDR 增益图原样）
//       3 紧凑 = 以上 + 实况视频转 SDR（浏览器 WebCodecs 经 canvas 取 8-bit 帧转 SDR）
//       4 极致 = 以上 + 去掉增益图（不再是 HDR），可按最长边缩小

const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
const enc = new TextEncoder();
const dec = new TextDecoder();
const ascii = (u8, start, len) => String.fromCharCode(...u8.subarray(start, start + len));

// JPEG 头部各段（到 SOS 为止）；rest 为 SOS 起到结尾
function segments(u8) {
  if (u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('not jpeg');
  const segs = [];
  let i = 2;
  while (i + 4 <= u8.length) {
    if (u8[i] !== 0xff) throw new Error('bad marker');
    const m = u8[i + 1];
    if (m === 0xff) { i++; continue; } // 填充字节
    if (m === 0xda) return { segs, rest: u8.subarray(i) };
    const len = (u8[i + 2] << 8) | u8[i + 3];
    segs.push({ m, bytes: u8.subarray(i, i + 2 + len) });
    i += 2 + len;
  }
  throw new Error('no SOS');
}
const isApp = (s) => s.m >= 0xe0 && s.m <= 0xef;
const payloadStarts = (s, tag) => ascii(s.bytes, 4, tag.length) === tag;
const isXmp = (s) => s.m === 0xe1 && payloadStarts(s, XMP_NS);
const isMpf = (s) => s.m === 0xe2 && payloadStarts(s, 'MPF\0');
const isQti = (s) => payloadStarts(s, 'QTI Debug');

function appSeg(marker, payload) {
  const out = new Uint8Array(payload.length + 4);
  out.set([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  out.set(payload, 4);
  return out;
}

const attr = (xml, name) => xml.match(new RegExp(`${name}="([^"]*)"`))?.[1];
// Container:Directory 里的各项（属性顺序不固定）
function items(xmp) {
  return [...xmp.matchAll(/<Container:Item\b[^>]*?\/?>/g)].map((m) => ({
    tag: m[0],
    semantic: attr(m[0], 'Item:Semantic'),
    length: Number(attr(m[0], 'Item:Length') || 0),
    padding: Number(attr(m[0], 'Item:Padding') || 0),
  }));
}

/** 拆解实况 JPEG；认不出就返回 null（调用方原样上传） */
export function parseLive(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let head;
  try {
    head = segments(u8);
  } catch {
    return null;
  }
  const xmpSeg = head.segs.find(isXmp);
  if (!xmpSeg) return null;
  const xmp = dec.decode(xmpSeg.bytes.subarray(4 + XMP_NS.length));
  const list = items(xmp);
  const motion = list.find((it) => it.semantic === 'MotionPhoto');
  const gain = list.find((it) => it.semantic === 'GainMap');
  if (list.some((it) => it.padding)) return null; // 有填充的布局没见过样本，不碰

  let videoStart;
  if (motion?.length) videoStart = u8.length - motion.length;
  else if (attr(xmp, 'GCamera:MicroVideoOffset')) videoStart = u8.length - Number(attr(xmp, 'GCamera:MicroVideoOffset'));
  else return null;
  if (!(videoStart > 0) || ascii(u8, videoStart + 4, 4) !== 'ftyp') return null;

  const gainStart = gain ? videoStart - gain.length : videoStart;
  if (gain && (u8[gainStart] !== 0xff || u8[gainStart + 1] !== 0xd8)) return null;
  // 只认「主图 + 增益图」两项的 MPF，其他布局不碰
  const mpf = head.segs.find(isMpf);
  if (mpf && mpfEntries(mpf.bytes).count !== (gain ? 2 : 1)) return null;
  if (!mpf && gain) return null;

  // OPlus：VideoLength 之后是私有尾部（机型信息 + 选帧用的短片）
  const vlen = Number(attr(xmp, 'OpCamera:VideoLength') || 0);
  const videoEnd = vlen && vlen < u8.length - videoStart ? videoStart + vlen : u8.length;
  return {
    segs: head.segs,
    xmp,
    primary: u8.subarray(0, gainStart),
    gainmap: gain ? u8.subarray(gainStart, videoStart) : null,
    video: u8.subarray(videoStart, videoEnd),
    tail: u8.subarray(videoEnd),
    legacyOffset: !motion, // 旧版 MicroVideoOffset：从文件尾倒数，视频不变就不用改
    size: u8.length,
  };
}

function mpfEntries(bytes) {
  const t = 8; // FFE2 + 长度 + "MPF\0"
  const be = bytes[t] === 0x4d;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifd = t + dv.getUint32(t + 4, !be);
  const n = dv.getUint16(ifd, !be);
  let count = 0;
  let off = 0;
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + 12 * k;
    const tag = dv.getUint16(e, !be);
    if (tag === 0xb001) count = dv.getUint32(e + 8, !be);
    if (tag === 0xb002) off = t + dv.getUint32(e + 8, !be);
  }
  return { count, off, be, dv };
}

// 非 APP 段（DQT/SOF/DHT…）+ SOS 起的扫描数据
function bodyOf(jpeg) {
  const { segs, rest } = segments(jpeg);
  return concat([...segs.filter((s) => !isApp(s)).map((s) => s.bytes), rest]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * 按级别重组
 * @param live parseLive 的结果
 * @param level 1 | 2 | 3 | 4
 * @param encode async (primaryBlob, dropHdr) => Uint8Array|null  重新编码主图（返回完整 JPEG），null = 不换
 * @param encodeVideo async (videoBytes) => transcodeVideo 的结果（级别 ≥3 才调用）
 */
export async function slimLive(live, level, encode, encodeVideo) {
  const keepGain = live.gainmap && level < 4;
  const tail = new Uint8Array(0); // 各级都去掉私有尾部
  const keepMpf = keepGain || !live.gainmap; // 只有主图一项的 MPF（微信版）照留，只修补大小

  // 主图正文：级别 ≥2 才重编码；级别 2–3 至少小 10% 才换（已经压过的图不再折腾），级别 4 只要变小就换（绝不换成更大的主图）
  const oldBody = bodyOf(live.primary);
  let body = oldBody;
  let recoded = false;
  if (level >= 2) {
    const out = await encode(new Blob([live.primary], { type: 'image/jpeg' }), level >= 4);
    if (out) {
      const nb = bodyOf(out);
      if (nb.length < (level >= 4 ? oldBody.length : oldBody.length * 0.9)) {
        body = nb;
        recoded = true;
      }
    }
  }

  // 视频：级别 ≥3 转 SDR，变小才换
  let video = live.video;
  let videoSkip = null;
  if (level >= 3) {
    const r = await encodeVideo(live.video);
    if (r.bytes && r.bytes.length < video.length) video = r.bytes;
    else videoSkip = r.skip || 'larger';
  }

  // XMP：更新视频长度；极致级删掉增益图条目与 hdrgm
  let xmp = live.xmp;
  const motionLen = video.length + tail.length;
  xmp = xmp.replace(/OpCamera:VideoLength="\d+"/, `OpCamera:VideoLength="${video.length}"`);
  xmp = xmp.replace(/<Container:Item\b[^>]*?\/?>/g, (tag) =>
    /Item:Semantic="MotionPhoto"/.test(tag) ? tag.replace(/Item:Length="\d+"/, `Item:Length="${motionLen}"`) : tag,
  );
  if (live.legacyOffset) xmp = xmp.replace(/GCamera:MicroVideoOffset="\d+"/, `GCamera:MicroVideoOffset="${motionLen}"`);
  if (!keepGain && live.gainmap) {
    xmp = xmp
      .replace(/<rdf:li\b[^>]*>\s*<Container:Item\b[^>]*Item:Semantic="GainMap"[^>]*\/?>(?:\s*<\/Container:Item>)?\s*<\/rdf:li>/g, '')
      .replace(/\s*hdrgm:Version="[^"]*"/g, '')
      .replace(/\s*xmlns:hdrgm="[^"]*"/g, '');
  }

  const appSegs = [];
  for (const s of live.segs) {
    if (!isApp(s)) continue;
    if (isQti(s)) continue;
    if (isXmp(s)) appSegs.push(appSeg(0xe1, concat([enc.encode(XMP_NS), enc.encode(xmp)])));
    else if (isMpf(s)) {
      if (keepMpf) appSegs.push(s.bytes.slice()); // 下面再修补偏移
    } else appSegs.push(s.bytes);
  }
  const head = concat([new Uint8Array([0xff, 0xd8]), ...appSegs]);

  if (keepMpf) {
    // MPF：主图大小、增益图偏移（相对 MPF 的 TIFF 头）
    const primarySize = head.length + body.length;
    let pos = 2;
    for (const seg of appSegs) {
      if (seg[1] === 0xe2 && ascii(seg, 4, 4) === 'MPF\0') {
        const { off, be, dv } = mpfEntries(seg);
        dv.setUint32(off + 4, primarySize, !be);
        if (keepGain) {
          dv.setUint32(off + 16 + 4, live.gainmap.length, !be);
          dv.setUint32(off + 16 + 8, primarySize - (pos + 8), !be);
        }
        head.set(seg, pos);
        break;
      }
      pos += seg.length;
    }
  }

  const parts = [head, body];
  if (keepGain) parts.push(live.gainmap);
  parts.push(video, tail);
  return { bytes: concat(parts), recoded, videoDone: video !== live.video, videoSkip, droppedTail: live.tail.length > 0 && !tail.length, droppedHdr: !!live.gainmap && !keepGain };
}

// 编码器优先 HEVC，不支持时退到 H.264（WebCodecs 普遍支持）
const VIDEO_CODECS = ['hevc', 'avc'];
// 每像素每帧的目标比特数（高 / 均衡 / 小）；硬件编码器效率不如 x265，比电脑上的 CRF 24 给得宽一些
const VIDEO_BPP = { high: 0.14, balanced: 0.1, small: 0.07 };

/**
 * 实况视频转 8-bit SDR（HEVC，退而 H.264）。HDR 视频经 canvas 由 Chrome 转成 BT.709，高饱和色会被截断（用户已接受）
 * 返回 { bytes } | { skip: 'low' }（原片码率已低）| { skip: 'unsupported' }（浏览器不能编 HEVC）
 */
export async function transcodeVideo(video, quality = 'balanced', onProgress) {
  const mbUrl = './vendor/mediabunny.min.mjs';
  const mb = await import(/* @vite-ignore */ mbUrl);
  const input = new mb.Input({ source: new mb.BufferSource(video), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return { skip: 'unsupported' };
  const stats = await track.computePacketStats();
  const target = Math.round(track.codedWidth * track.codedHeight * stats.averagePacketRate * VIDEO_BPP[quality]);
  if (stats.averageBitrate < target * 1.5) return { skip: 'low' }; // 微信转存版这类已经压过的不再折腾
  if (!(await track.canDecode())) return { skip: 'unsupported' };
  const codec = await mb.getFirstEncodableVideoCodec(VIDEO_CODECS, { width: track.codedWidth, height: track.codedHeight, bitrate: target });
  if (!codec) return { skip: 'unsupported' };

  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const conv = await mb.Conversion.init({
    input,
    output,
    video: { codec, bitrate: target, forceTranscode: true },
    audio: {}, // 音轨原样复制
  });
  if (!conv.isValid) return { skip: 'unsupported', why: conv.discardedTracks };
  if (onProgress) conv.onProgress = onProgress;
  await conv.execute();
  return { bytes: new Uint8Array(output.target.buffer), from: stats.averageBitrate, to: target };
}
