// 去除定位：把文件里的 GPS 信息原地清零，文件长度与结构不变（MPF 偏移、实况视频位置都不受影响，HDR 照样保留）
//   EXIF   支持「Exif\0\0 + TIFF 头」（JPEG 主图 / 增益图、HEIC、AVIF）、WebP 的 EXIF 块（直接接 TIFF 头）以及 PNG 的 eXIf 块（重算 CRC），清空 GPS IFD 及其数据
//   XMP    exif:GPS… 属性与元素换成等长空格
//   MP4/MOV ©xyz（Android / 多数相机）、loci（3GPP）改成 free 盒并清零；QuickTime 的 com.apple.quicktime.location（iPhone 视频）原地抹掉键名与 ISO 6709 坐标

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
const WEBP_EXIF = [0x45, 0x58, 0x49, 0x46]; // WebP "EXIF" chunk
const PNG_EXIF = [0x65, 0x58, 0x49, 0x66]; // PNG "eXIf" chunk
const QT_LOC = [0x63, 0x6f, 0x6d, 0x2e, 0x61, 0x70, 0x70, 0x6c, 0x65, 0x2e, 0x71, 0x75, 0x69, 0x63, 0x6b, 0x74, 0x69, 0x6d, 0x65, 0x2e, 0x6c, 0x6f, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e]; // "com.apple.quicktime.location"

/** 原地清除 u8 中的 GPS 信息，返回清除的处数（供浏览器与 Worker 服务端共用） */
export function stripGpsBytes(u8) {
  return stripExif(u8) + stripXmp(u8) + stripMp4(u8);
}

/** 返回去掉定位后的 Blob；没有定位信息时返回原 Blob */
export async function stripGps(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  return stripGpsBytes(u8) ? new Blob([u8], { type: blob.type }) : blob;
}

// 在 u8 里找字节序列，返回下标或 -1
function find(u8, seq, from) {
  for (let i = u8.indexOf(seq[0], from); i >= 0 && i <= u8.length - seq.length; i = u8.indexOf(seq[0], i + 1)) {
    let k = 1;
    while (k < seq.length && u8[i + k] === seq[k]) k++;
    if (k === seq.length) return i;
  }
  return -1;
}

// 在偏移 t 处检查 TIFF 头并原地清空 GPS IFD（0x8825），返回是否清除了 GPS
function clearTiffGps(u8, t, limit = u8.length) {
  if (t + 8 > limit) return false;
  const le = u8[t] === 0x49 && u8[t + 1] === 0x49 && u8[t + 2] === 0x2a && u8[t + 3] === 0;
  const be = u8[t] === 0x4d && u8[t + 1] === 0x4d && u8[t + 2] === 0 && u8[t + 3] === 0x2a;
  if (!le && !be) return false;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const ok = (o, len) => o >= t && o + len <= limit;
  const ifd0 = t + u32(t + 4);
  if (!ok(ifd0, 2)) return false;
  const n0 = u16(ifd0);
  if (!ok(ifd0 + 2, n0 * 12)) return false;
  for (let e = 0; e < n0; e++) {
    const p = ifd0 + 2 + e * 12;
    if (u16(p) !== 0x8825) continue; // GPS IFD 指针
    const gps = t + u32(p + 8);
    if (!ok(gps, 2)) return false;
    const n = u16(gps);
    if (!n || !ok(gps + 2, n * 12)) return false;
    for (let g = 0; g < n; g++) {
      const q = gps + 2 + g * 12;
      const len = (TYPE_SIZE[u16(q + 2)] || 1) * u32(q + 4);
      const at = t + u32(q + 8);
      if (len > 4 && ok(at, len)) u8.fill(0, at, at + len); // 放在别处的值（经纬度等）
    }
    u8.fill(0, gps, gps + 2 + n * 12); // 条目数归零，条目本身也清掉
    return true;
  }
  return false;
}

function crc32(u8, start, end) {
  let c = -1;
  for (let i = start; i < end; i++) {
    c ^= u8[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ -1) >>> 0;
}

function stripExif(u8) {
  let count = 0;
  // 1. JPEG / HEIC / AVIF（以及部分带 Exif\0\0 前缀的 WebP）
  for (let i = find(u8, EXIF, 0); i >= 0; i = find(u8, EXIF, i + 6)) {
    if (clearTiffGps(u8, i + 6)) count++;
  }
  // 2. 标准 WebP 的 EXIF 块：'EXIF'(4) + size(4, LE) + TIFF 头（无 Exif\0\0 前缀）
  const isWebp = u8.length > 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50;
  if (isWebp) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let i = find(u8, WEBP_EXIF, 12); i >= 0 && i + 8 <= u8.length; i = find(u8, WEBP_EXIF, i + 4)) {
      const size = dv.getUint32(i + 4, true);
      if (clearTiffGps(u8, i + 8, Math.min(u8.length, i + 8 + size))) count++;
    }
  }
  // 3. PNG 的 eXIf 块：size(4, BE) + 'eXIf'(4) + TIFF 头 + CRC(4, BE)
  const isPng = u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  if (isPng) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let i = find(u8, PNG_EXIF, 8); i >= 4 && i + 8 <= u8.length; i = find(u8, PNG_EXIF, i + 4)) {
      const size = dv.getUint32(i - 4);
      const end = i + 4 + size;
      if (end + 4 <= u8.length && clearTiffGps(u8, i + 4, end)) {
        dv.setUint32(end, crc32(u8, i, end));
        count++;
      }
    }
  }
  return count;
}

// XMP 只出现在文件头部附近（JPEG 的 APP1、HEIF 的 mime 项），扫前 2MB
function stripXmp(u8) {
  const end = Math.min(u8.length, 2 * 1024 * 1024);
  let s = '';
  for (let i = 0; i < end; i += 65536) s += String.fromCharCode(...u8.subarray(i, Math.min(end, i + 65536)));
  if (!s.includes('exif:GPS')) return 0;
  let count = 0;
  const re = /\sexif:GPS\w+="[^"]*"|<exif:GPS(\w+)\b[^>]*>[\s\S]*?<\/exif:GPS\1>|<exif:GPS\w+\b[^>]*\/>/g;
  for (const m of s.matchAll(re)) {
    // 只替换 ASCII 范围，长度按字节不变
    if (/[^\x20-\x7e\s]/.test(m[0])) continue;
    u8.fill(0x20, m.index, m.index + m[0].length);
    count++;
  }
  return count;
}

const FREE = [0x66, 0x72, 0x65, 0x65];
function stripMp4(u8) {
  let count = 0;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // ©xyz：size(4) '©xyz' strlen(2) lang(2) "+31.2304+121.4737/"
  for (let i = find(u8, [0xa9, 0x78, 0x79, 0x7a], 4); i >= 0; i = find(u8, [0xa9, 0x78, 0x79, 0x7a], i + 4)) {
    const size = dv.getUint32(i - 4);
    if (size < 12 || size > 256 || i - 4 + size > u8.length) continue;
    const len = dv.getUint16(i + 4);
    if (len + 12 !== size) continue;
    const str = String.fromCharCode(...u8.subarray(i + 8, i + 8 + len));
    if (!/^[+-][\d.+\-/A-Za-z]*$/.test(str)) continue;
    u8.set(FREE, i);
    u8.fill(0, i + 4, i - 4 + size);
    count++;
  }
  // loci：size(4) 'loci' version/flags(4) lang(2) name\0 role(1) lon(4) lat(4) alt(4) body\0 notes\0
  for (let i = find(u8, [0x6c, 0x6f, 0x63, 0x69], 4); i >= 0; i = find(u8, [0x6c, 0x6f, 0x63, 0x69], i + 4)) {
    const size = dv.getUint32(i - 4);
    if (size < 26 || size > 512 || i - 4 + size > u8.length || dv.getUint32(i + 4) !== 0) continue;
    u8.set(FREE, i);
    u8.fill(0, i + 4, i - 4 + size);
    count++;
  }
  // QuickTime / iPhone 视频：mdta keys 里的 com.apple.quicktime.location.* 与 ilst 里的 ISO 6709 坐标 data 盒
  for (let i = find(u8, QT_LOC, 0); i >= 0; i = find(u8, QT_LOC, i + QT_LOC.length)) {
    u8.fill(0x5f, i + 20, i + 28); // 把 "location" 改成 "________"，使元数据键名失效
    count++;
  }
  for (let i = find(u8, [0x64, 0x61, 0x74, 0x61], 4); i >= 0; i = find(u8, [0x64, 0x61, 0x74, 0x61], i + 4)) {
    const size = dv.getUint32(i - 4);
    if (size < 24 || size > 256 || i - 4 + size > u8.length) continue;
    const str = String.fromCharCode(...u8.subarray(i + 12, i - 4 + size));
    if (!/^[+-]\d{2,6}\.\d+[+-]\d{3,7}\.\d+[+-.\dA-Za-z_=\s]*\/$/.test(str)) continue;
    u8.fill(0, i + 12, i - 4 + size);
    count++;
  }
  return count;
}
