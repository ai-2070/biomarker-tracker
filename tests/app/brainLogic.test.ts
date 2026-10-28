import { describe, expect, it } from "vitest";
import { ATTACHED_TEXT_LIMIT, brainShortcut, isTextFile, questionWithFiles, redactName, type KeyLike } from "../../src/app/brain/logic";

const key = (k: string, more: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...more });
const idle = { open: false, onInteractive: false, overlayOpen: false };

describe("Brain shortcut", () => {
  it("opens with Space only when nothing else uses it", () => {
    expect(brainShortcut(key(" "), idle)).toBe("open");
    expect(brainShortcut(key(" "), { ...idle, onInteractive: true })).toBeNull();
    expect(brainShortcut(key(" "), { ...idle, open: true })).toBeNull();
    expect(brainShortcut(key(" "), { ...idle, overlayOpen: true })).toBeNull();
    expect(brainShortcut(key(" ", { repeat: true }), idle)).toBeNull();
    expect(brainShortcut(key(" ", { shiftKey: true }), idle)).toBeNull();
    expect(brainShortcut(key(" ", { defaultPrevented: true }), idle)).toBeNull();
    expect(brainShortcut(key(" ", { isComposing: true }), idle)).toBeNull();
    expect(brainShortcut(key("a"), idle)).toBeNull();
  });
  it("toggles with Ctrl+K or Cmd+K, also from a field", () => {
    expect(brainShortcut(key("k", { ctrlKey: true }), { ...idle, onInteractive: true })).toBe("toggle");
    expect(brainShortcut(key("K", { metaKey: true }), { ...idle, open: true })).toBe("toggle");
    expect(brainShortcut(key("k", { ctrlKey: true, shiftKey: true }), idle)).toBeNull();
    expect(brainShortcut(key("k", { ctrlKey: true }), { ...idle, overlayOpen: true })).toBeNull();
  });
});

describe("attached files", () => {
  it("adds each file's text after the question, shortened to fit", () => {
    expect(questionWithFiles("Hi", [])).toBe("Hi");
    const q = questionWithFiles("What is this?", [{ name: "a.txt", text: "Hello" }]);
    expect(q).toContain("What is this?");
    expect(q).toContain("--- Attached file: a.txt");
    expect(q).toContain("Hello");
    const long = questionWithFiles("", [
      { name: "a.txt", text: "x".repeat(20_000) },
      { name: "b.txt", text: "y".repeat(20_000) },
    ]);
    expect(long.startsWith("Please look at the attached file.")).toBe(true);
    expect(long.length).toBeLessThan(ATTACHED_TEXT_LIMIT + 1_000);
    expect(long).toContain("the rest of this file was left out");
  });
  it("hides the person's name in document text", () => {
    expect(redactName("Patient: Sam Example, born 1980. Dr. Samuelson", "Sam Example")).toBe("Patient: [name] [name], born 1980. Dr. Samuelson");
    expect(redactName("ÁGNES KOVÁCS", "Ágnes Kovács")).toBe("[name] [name]");
    expect(redactName("Al and Bo", "Al Bo")).toBe("Al and Bo");
    expect(redactName("text", undefined)).toBe("text");
  });
  it("knows which files are plain text", () => {
    expect(isTextFile("results.csv", "")).toBe(true);
    expect(isTextFile("notes", "text/plain")).toBe(true);
    expect(isTextFile("report.pdf", "application/pdf")).toBe(false);
  });
});
