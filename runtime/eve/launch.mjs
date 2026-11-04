// The main server owns this private process through stdin: when it closes (also after a crash), stop.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(1));
process.stdin.resume();
await import("./server/index.mjs");
