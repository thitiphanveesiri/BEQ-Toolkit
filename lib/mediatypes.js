// ชนิดไฟล์รูปภาพ/วิดีโอที่รับ (ใช้ร่วมกันทั้งฝั่งเบราว์เซอร์และ server)
// รับทุกสกุลที่เป็นรูป/วิดีโอ — บางเครื่อง (เช่น HEIC, MKV, AVI) เบราว์เซอร์ไม่ส่งชนิดไฟล์มา จึงเทียบจากนามสกุลด้วย
export const IMG_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', hif: 'image/heif', avif: 'image/avif', jp2: 'image/jp2', dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2', nef: 'image/x-nikon-nef', arw: 'image/x-sony-arw', raw: 'image/x-raw', ico: 'image/x-icon',
};
export const VID_EXT = {
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', qt: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', flv: 'video/x-flv', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', mpg: 'video/mpeg', mpeg: 'video/mpeg', mts: 'video/mp2t', m2ts: 'video/mp2t',
  ts: 'video/mp2t', ogv: 'video/ogg', mxf: 'application/mxf', hevc: 'video/hevc',
};
export const extOf = (name) => (/\.([A-Za-z0-9]{1,6})$/.exec(String(name || '')) || [])[1]?.toLowerCase() || '';
// คืน { kind, mime } หรือ null — ใช้ชนิดที่เบราว์เซอร์ให้มา ถ้าไม่มีใช้นามสกุล
export function classify(name, type) {
  const t = String(type || '').toLowerCase(), e = extOf(name);
  if (/^image\/[a-z0-9.+-]+$/.test(t) && t !== 'image/svg+xml') return { kind: 'image', mime: t };
  if (/^video\/[a-z0-9.+-]+$/.test(t)) return { kind: 'video', mime: t };
  if (IMG_EXT[e]) return { kind: 'image', mime: IMG_EXT[e] };
  if (VID_EXT[e]) return { kind: 'video', mime: VID_EXT[e] };
  return null;
}
export const ACCEPT_IMG = 'image/*,.heic,.heif,.hif,.tif,.tiff,.avif,.dng,.jfif';
export const ACCEPT_VID = 'video/*,.mkv,.avi,.wmv,.flv,.3gp,.3g2,.mts,.m2ts,.mpg,.mpeg,.mov,.m4v,.hevc';
