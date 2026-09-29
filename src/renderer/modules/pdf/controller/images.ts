/** Reading a user-chosen image for "Add image": PNG/JPEG bytes as-is, other formats converted to PNG. */

export interface PreparedImage {
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

function signature(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = signature(bytes);
    if (mime) return { data: bytes, mime, width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Opens the system file chooser for one image (must run during a user gesture). */
export function chooseImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPT;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
