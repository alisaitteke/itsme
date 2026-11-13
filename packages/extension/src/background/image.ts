export interface Png {
  data: string;
  width: number;
  height: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // String.fromCharCode takes its input as arguments, so feed it in slices.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Captures come out in device pixels. Scaled to the viewport's CSS pixels, a point in
 * the image is the same point the mouse commands take, and the image is a quarter the
 * size on a 2x display.
 */
export async function pngAtViewportSize(
  dataUrl: string,
  viewport: { width: number; height: number } | null,
): Promise<Png> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const width = viewport?.width ?? bitmap.width;
  const height = viewport?.height ?? bitmap.height;
  if (width === bitmap.width && height === bitmap.height) {
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height };
  }

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: toBase64(new Uint8Array(await blob.arrayBuffer())), width, height };
}
