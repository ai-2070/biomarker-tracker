/** A picture ready to send to Brain: base64 JPEG. */
export interface PreparedPhoto {
  mediaType: "image/jpeg";
  data: string;
}

/** Longest side of a picture sent to a model: enough to read a lab report, small enough to send quickly. */
export const MAX_PHOTO_SIDE = 1568;

/**
 * Prepares a photo to send to a model: drawn onto a canvas at most 1568 px on its longest side and
 * saved again as JPEG. Re-encoding also drops the file's metadata (EXIF), such as the GPS location
 * and the phone model, which never leaves this computer.
 */
export async function shrinkPhoto(file: Blob, maxSide = MAX_PHOTO_SIDE): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't open this picture. Save it as JPG or PNG and try again.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}
