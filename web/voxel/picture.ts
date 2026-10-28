// "Save a picture": the voxel view on screen registers how to draw what you see, and the World panel asks
// for it here (the panel doesn't hold the Station's renderer).
type Source = (width: number) => string;
let source: Source | null = null;

/** The view that can draw a picture now (null when the voxel look is off). Returns how to unregister. */
export function setPictureSource(fn: Source): () => void {
  source = fn;
  return () => {
    if (source === fn) source = null;
  };
}

export const canTakePicture = (): boolean => !!source;

/** What you see on the Station, as a JPEG data: URL `width` pixels wide (null when it can't be drawn). */
export function takePicture(width = 1600): string | null {
  return source ? source(width) : null;
}
