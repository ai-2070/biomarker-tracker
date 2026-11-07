import { deflateRawSync } from "node:zlib";
import { zipEntries } from "@bt/shared/core/importers/zipRead";
import { crc32, zipStore } from "@bt/shared/core/zipStore";
import { describe, expect, it, vi } from "vitest";

function compressedZip(data: Uint8Array) {
  const compressed = deflateRawSync(data);
  const name = new TextEncoder().encode("export.csv");
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc32(data), true);
  lv.setUint32(18, compressed.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc32(data), true);
  cv.setUint32(20, compressed.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + compressed.length, true);
  return new Blob([local, compressed, central, end] as BlobPart[]);
}

function trackedBlob(blob: Blob) {
  const stats = { bytes: 0, opens: 0, cancelled: undefined as unknown };
  const originalSlice = blob.slice.bind(blob);
  vi.spyOn(blob, "slice").mockImplementation((start, end) => {
    const part = originalSlice(start, end);
    Object.defineProperty(part, "stream", {
      value: () => {
        stats.opens++;
        let offset = 0;
        return new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              if (offset >= part.size) return controller.close();
              const chunk = new Uint8Array(await part.slice(offset, offset + 65_536).arrayBuffer());
              offset += chunk.byteLength;
              stats.bytes += chunk.byteLength;
              controller.enqueue(chunk);
            },
            cancel(reason) {
              stats.cancelled = reason;
            },
          },
          { highWaterMark: 0 },
        );
      },
    });
    return part;
  });
  return stats;
}

// An event-loop checkpoint, not a delay chosen to hide a race.
async function checkpoint() {
  const gate = Promise.withResolvers<void>();
  setImmediate(gate.resolve);
  await gate.promise;
}

describe("ZIP demand and cancellation boundaries", () => {
  it("does not consume a stored entry before demand, and cancellation reaches its source", async () => {
    const payload = new Uint8Array(8 * 1024 * 1024).fill(65);
    const blob = new Blob([zipStore([{ name: "export.xml", data: payload }]) as BlobPart]);
    const stats = trackedBlob(blob);
    const [entry] = await zipEntries(blob);
    const stream = entry!.stream();
    await checkpoint();
    expect(stats.opens).toBe(0);
    expect(stats.bytes).toBe(0);
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.value).toEqual(payload.slice(0, 65_536));
    await checkpoint();
    expect(stats.bytes).toBe(65_536);
    await reader.cancel("stop importing");
    expect(stats.cancelled).toBe("stop importing");
    const bytesAtCancel = stats.bytes;
    await checkpoint();
    expect(stats.bytes).toBe(bytesAtCancel);
  });

  it("bounds compressed input while a decompressed consumer stops reading and propagates cancel", async () => {
    const payload = new Uint8Array(4 * 1024 * 1024);
    let seed = 123456789;
    for (let i = 0; i < payload.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      payload[i] = seed & 255;
    }
    const blob = compressedZip(payload);
    const stats = trackedBlob(blob);
    const [entry] = await zipEntries(blob);
    const reader = entry!.stream().getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value).toEqual(payload.slice(0, first.value!.byteLength));
    await checkpoint();
    expect(stats.bytes).toBeLessThan(payload.length / 2);
    await reader.cancel("cancel compressed import");
    await checkpoint();
    expect(stats.cancelled).toBe("cancel compressed import");
  });
});
