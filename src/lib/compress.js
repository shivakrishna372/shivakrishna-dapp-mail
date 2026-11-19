// Shrinks large photos before upload (saves storage). Other files are left untouched.
const MAX_SIDE = 2000;      // pixels
const QUALITY = 0.82;       // JPEG quality
const MIN_BYTES = 400 * 1024;

export async function compressImage(file) {
  const compressible = /^image\/(jpeg|webp)$/.test(file.type) || (file.type === 'image/png' && file.size > 1024 * 1024);
  if (!compressible || file.size < MIN_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG transparency becomes white in the JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file; // unsupported format in this browser: upload as-is
  }
}
