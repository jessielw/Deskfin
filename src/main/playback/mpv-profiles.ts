import { spawn } from "node:child_process";
import type { MpvProfileDiscovery, MpvProfileSummary } from "../../shared/types";
import { normalizeMpvProfile } from "../../shared/mpv-profile";
import { detectMpvProvider, isMpvProvider } from "./mpv-provider";

const PROFILE_DISCOVERY_TIMEOUT_MS = 3000;
const MAX_PROFILE_OUTPUT_BYTES = 128 * 1024;
const RESERVED_PROFILES = new Set(["default", "pseudo-gui", "builtin-pseudo-gui"]);

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface DiscoverMpvProfileOptions {
  run?: (executable: string) => Promise<ProcessResult>;
}

export function parseMpvProfileOutput(output: string): MpvProfileSummary[] {
  const header = output.match(/(?:^|\r?\n)\s*Available profiles:\s*(?:\r?\n|$)/i);
  if (!header || header.index == null) return [];
  const body = output.slice(header.index + header[0].length);
  const profiles = new Map<string, MpvProfileSummary>();
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^\s{2,}(\S+?)(?:\s{2,}(.+))?\s*$/u);
    if (!match?.[1]) continue;
    const name = match[1].trim();
    if (
      !name ||
      RESERVED_PROFILES.has(name) ||
      name.startsWith("extension.") ||
      name.startsWith("protocol.")
    ) {
      continue;
    }
    try {
      normalizeMpvProfile(name);
    } catch {
      continue;
    }
    profiles.set(name, {
      name,
      description: (match[2] || "").trim().slice(0, 512),
    });
  }
  return [...profiles.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function runProfileProbe(executable: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--profile=help"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ProcessResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString()}`.slice(0, MAX_PROFILE_OUTPUT_BYTES);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish({ code, stdout, stderr }));
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("MPV profile discovery timed out"));
    }, PROFILE_DISCOVERY_TIMEOUT_MS);
  });
}

export async function discoverMpvProfiles(
  executable: string,
  { run = runProfileProbe }: DiscoverMpvProfileOptions = {},
): Promise<MpvProfileDiscovery> {
  const provider = detectMpvProvider(executable);
  if (!isMpvProvider(provider)) {
    return {
      profiles: [],
      reason: "Select an MPV or mpv.net executable before discovering profiles",
    };
  }
  if (provider === "mpv.net") {
    return {
      profiles: [],
      reason:
        "mpv.net displays profiles in its own window; enter the profile name manually",
    };
  }
  try {
    const result = await run(executable);
    const output = `${result.stdout}\n${result.stderr}`;
    const profiles = parseMpvProfileOutput(output);
    if (profiles.length > 0) return { profiles, reason: "" };
    const firstLine = (result.stderr || result.stdout)
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^Available profiles:$/i.test(line))
      ?.slice(0, 512);
    return {
      profiles: [],
      reason:
        firstLine ||
        (result.code === 0
          ? "MPV did not report any selectable profiles"
          : `MPV profile discovery exited with code ${result.code}`),
    };
  } catch (error: unknown) {
    return {
      profiles: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
