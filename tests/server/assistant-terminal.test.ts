import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), which: vi.fn(), unref: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../apps/server/which", () => ({ which: mocks.which }));
import { openAgentSignIn } from "../../apps/server/terminal";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  mocks.spawn.mockReset().mockReturnValue({ unref: mocks.unref });
  mocks.which.mockReset();
  mocks.unref.mockClear();
});
afterEach(() => { Object.defineProperty(process, "platform", platform); });

describe("resolved agent sign-in launcher", () => {
  it("assistant-signin-windows launches the detected absolute executable with fixed arguments", () => {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    mocks.which.mockReturnValue("C:\\New O'Brien Install\\hermes.exe");
    expect(openAgentSignIn("hermes")).toEqual({ ok: true });
    expect(mocks.which).toHaveBeenCalledTimes(1);
    expect(mocks.which).toHaveBeenCalledWith("hermes");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [command, args] = mocks.spawn.mock.calls[0]!;
    expect(command).toBe("cmd.exe");
    const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
    expect(script).toContain("; & 'C:\\New O''Brien Install\\hermes.exe' 'setup'");
    expect(script).not.toMatch(/; hermes setup$/);
    expect(mocks.unref).toHaveBeenCalledTimes(1);
  });

  it("assistant-signin-linux quotes the resolved executable, including spaces and apostrophes", () => {
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    mocks.which.mockImplementation((command: string) => command === "hermes" ? "/home/person/New O'Brien Install/hermes" : "/usr/bin/x-terminal-emulator");
    expect(openAgentSignIn("hermes")).toEqual({ ok: true });
    const [command, args] = mocks.spawn.mock.calls[0]!;
    expect(command).toBe("x-terminal-emulator");
    expect(args).toEqual(["-e", "bash", "-c", "'/home/person/New O'\\''Brien Install/hermes' 'setup'; echo; exec bash"]);
  });

  it("assistant-signin-missing refuses without starting a terminal, and a detected install succeeds", () => {
    mocks.which.mockReturnValue(null);
    expect(openAgentSignIn("codex")).toEqual({ ok: false, error: expect.stringMatching(/isn't installed/) });
    expect(mocks.spawn).not.toHaveBeenCalled();
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    mocks.which.mockReturnValue("/Users/person/.local/bin/codex");
    expect(openAgentSignIn("codex")).toEqual({ ok: true });
    expect(mocks.spawn.mock.calls[0]?.[0]).toBe("osascript");
    expect(mocks.spawn.mock.calls[0]?.[1][1]).toContain("'/Users/person/.local/bin/codex'");
  });
});
