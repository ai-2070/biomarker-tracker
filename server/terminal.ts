// Opens a visible terminal window that runs one command, so the person sees what runs and can answer
// questions (installers and sign-ins are interactive). Only fixed commands from src/core/aiProviders.ts.
import { spawn } from "node:child_process";
import { which } from "./which";
import { providerInfo, type ProviderId } from "../src/core/aiProviders";

/** Resolve exactly the installed command, then quote it for the terminal's shell. */
export function openAgentSignIn(provider: ProviderId): { ok: true } | { ok: false; error: string } {
  const info = providerInfo(provider);
  if (info?.kind !== "agent" || !info.command || !info.install) return { ok: false, error: "Unknown agent program." };
  const executable = which(info.command);
  if (!executable) return { ok: false, error: `${info.label} isn't installed on this computer.` };
  const args = info.install.signIn.split(" ").slice(1);
  const quote = process.platform === "win32"
    ? (value: string) => `'${value.replace(/'/g, "''")}'`
    : (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const command = `${process.platform === "win32" ? "& " : ""}${[executable, ...args].map(quote).join(" ")}`;
  return openTerminal(`Sign in to ${info.label}`, command);
}

export function openTerminal(title: string, command: string): { ok: true } | { ok: false; error: string } {
  try {
    if (process.platform === "win32") {
      // -EncodedCommand (UTF-16LE, base64) avoids every quoting problem between cmd, start and PowerShell.
      const script = `$Host.UI.RawUI.WindowTitle = '${title.replace(/'/g, "")}'; Write-Host '> ${command.replace(/'/g, "''")}'; ${command}`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      spawn("cmd.exe", ["/d", "/c", "start", `"${title.replace(/"/g, "")}"`, "powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
      }).unref();
      return { ok: true };
    }
    if (process.platform === "darwin") {
      const esc = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      spawn("osascript", ["-e", `tell application "Terminal" to do script "${esc}"`, "-e", 'tell application "Terminal" to activate'], { detached: true, stdio: "ignore" }).unref();
      return { ok: true };
    }
    const shell = `${command}; echo; exec bash`;
    const terminals: [string, string[]][] = [
      ["x-terminal-emulator", ["-e", "bash", "-c", shell]],
      ["gnome-terminal", ["--", "bash", "-c", shell]],
      ["konsole", ["-e", "bash", "-c", shell]],
      ["xfce4-terminal", ["-x", "bash", "-c", shell]],
      ["xterm", ["-e", "bash", "-c", shell]],
    ];
    const found = terminals.find(([cmd]) => which(cmd));
    if (!found) return { ok: false, error: "No terminal program was found. Open a terminal yourself and run the command shown." };
    spawn(found[0], found[1], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The terminal couldn't be opened." };
  }
}
