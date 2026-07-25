import type { MpvProvider } from "../../shared/types";

export function executableBaseName(executable: string): string {
  return (executable.split(/[\\/]/).pop() || "").toLowerCase();
}

export function detectMpvProvider(executable: string): MpvProvider {
  const name = executableBaseName(executable);
  if (/^mpv(?:\.net|net)(?:\.exe|\.com)?$/i.test(name)) {
    return "mpv.net";
  }
  if (/^mpv(?:\.exe|\.com)?$/i.test(name)) return "mpv";
  return "unknown";
}

export function isMpvProvider(
  provider: MpvProvider,
): provider is "mpv" | "mpv.net" {
  return provider === "mpv" || provider === "mpv.net";
}
