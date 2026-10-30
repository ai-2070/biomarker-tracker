/**
 * Reading zip files (device exports come zipped) without loading them whole: the central directory is
 * read from the end, and each entry is streamed from its slice of the file and inflated with the
 * built-in DecompressionStream. Supports stored and deflated entries and zip64 (exports over 4 GB).
 */

export interface ZipEntry {
  name: string;
  /** Uncompressed size in bytes. */
  size: number;
  stream(): ReadableStream<Uint8Array>;
  text(): Promise<string>;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));
const view = async (b: Blob) => new DataView(await b.arrayBuffer());

export async function zipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = await view(file.slice(tailStart));
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("This isn't a zip file, or it's damaged.");
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // zip64: the locator sits just before the end record and points at the zip64 end record.
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error("This zip file uses a format that can't be read here. Unzip it and choose the folder instead.");
    const rec = await view(file.slice(u64(tail, loc + 8), u64(tail, loc + 8) + 56));
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }

  const cd = await view(file.slice(cdOffset, cdOffset + cdSize));
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10);
    let compressed = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localOffset = u32(cd, p + 42);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // zip64 sizes and offset live in extra field 0x0001, in this order, only for fields set to 0xFFFFFFFF.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = u64(cd, q)), (q += 8);
        if (compressed === 0xffffffff) (compressed = u64(cd, q)), (q += 8);
        if (localOffset === 0xffffffff) localOffset = u64(cd, q);
      }
      e += 4 + len;
    }
    p = extraEnd + commentLen;
    if (name.endsWith("/")) continue;
    if (method !== 0 && method !== 8) continue; // other compression methods are very rare
    const stream = (): ReadableStream<Uint8Array> => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!reader) {
            const head = await view(file.slice(localOffset, localOffset + 30));
            if (cancelled) return;
            const start = localOffset + 30 + u16(head, 26) + u16(head, 28);
            reader = file.slice(start, start + compressed).stream().getReader();
          }
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) {
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(value);
        },
        async cancel(reason) {
          cancelled = true;
          await reader?.cancel(reason);
          reader?.releaseLock();
        },
      }, { highWaterMark: 0 });
      return method === 8 ? body.pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>) : body;
    };
    entries.push({
      name,
      size,
      stream,
      text: async () => new Response(stream()).text(),
    });
  }
  return entries;
}
