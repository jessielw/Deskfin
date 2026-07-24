import { spawn, type ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { validateMediaUrl } from "../../shared/url-policy";
import type {
  MpvEventName,
  MpvEventPayload,
  MpvLoadRequest,
  MpvPresentation,
  MpvStatus,
} from "../../shared/types";

const COMMAND_TIMEOUT_MS = 5000;
const START_TIMEOUT_MS = 5000;
const DEFAULT_INTEGRATION_SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "resources",
  "mpv",
  "jellyfin_dc.lua",
);
const JELLYFIN_OSC_OPTIONS = [
  "osc-layout=bottombar",
  "osc-seekbarstyle=bar",
  "osc-boxalpha=55",
  "osc-hidetimeout=1200",
  "osc-fadeduration=180",
  "osc-fadein=yes",
  "osc-timetotal=yes",
  "osc-scalefullscreen=1.1",
];

type MpvCommandPart = string | number | boolean;
type MpvCommand = MpvCommandPart[];
type MpvEventSink = (event: MpvEventName, payload: MpvEventPayload) => void;

interface PendingCommand {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: NodeJS.Timeout;
}

interface MpvControllerOptions {
  serverUrl: string;
  executable?: string;
  presentation?: MpvPresentation;
  integrationScript?: string | null;
  eventSink?: MpvEventSink;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function canRetryLoad(error: unknown): boolean {
  const message = errorMessage(error);
  return [
    "MPV is not ready",
    "MPV IPC failed",
    "MPV IPC closed",
    "MPV exited",
    "write EPIPE",
  ].some((needle) => message.includes(needle));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numberInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function trackNumber(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 999
  ) {
    throw new Error(`${field} must be an integer between 0 and 999`);
  }
  return value;
}

export function normalizeMpvPresentation(
  value: unknown = "jellyfin",
): MpvPresentation {
  const normalized = String(value).toLowerCase();
  if (normalized !== "jellyfin" && normalized !== "user") {
    throw new Error("--mpv-ui must be either jellyfin or user");
  }
  return normalized;
}

export function buildMpvArguments(
  ipcPath: string,
  presentation: MpvPresentation = "jellyfin",
  integrationScript: string | null = null,
): string[] {
  const args = [
    "--idle=yes",
    "--force-window=immediate",
    "--keep-open=no",
    "--input-default-bindings=yes",
    "--no-terminal",
    `--input-ipc-server=${ipcPath}`,
  ];
  if (normalizeMpvPresentation(presentation) === "jellyfin") {
    args.push(
      "--osc=yes",
      "--osd-on-seek=msg-bar",
      "--osd-duration=1800",
      ...JELLYFIN_OSC_OPTIONS.map((option) => `--script-opts-append=${option}`),
    );
  }
  if (integrationScript) args.push(`--script=${integrationScript}`);
  return args;
}

export function normalizeLoadRequest(
  value: unknown,
  serverUrl: string,
): MpvLoadRequest {
  if (!isRecord(value)) {
    throw new Error("The MPV load request must be an object");
  }
  const title = value.title ?? "";
  if (typeof title !== "string") throw new Error("title must be a string");
  const fullscreen = value.fullscreen ?? true;
  if (typeof fullscreen !== "boolean") {
    throw new Error("fullscreen must be a boolean");
  }

  const optionalUrl = (field: string): string | null => {
    const rawUrl = value[field];
    if (rawUrl == null || rawUrl === "") return null;
    return validateMediaUrl(rawUrl, serverUrl);
  };

  return {
    url: validateMediaUrl(value.url, serverUrl),
    startSeconds: numberInRange(
      value.startSeconds ?? 0,
      "startSeconds",
      0,
      315360000,
    ),
    title: title.slice(0, 512),
    fullscreen,
    audioTrack: trackNumber(value.audioTrack ?? 0, "audioTrack"),
    subtitleTrack: trackNumber(value.subtitleTrack ?? 0, "subtitleTrack"),
    externalAudioUrl: optionalUrl("externalAudioUrl"),
    externalSubtitleUrl: optionalUrl("externalSubtitleUrl"),
  };
}

function connectOnce(ipcPath: string, timeoutMs = 250): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ipcPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to MPV IPC"));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

export class MpvController {
  readonly serverUrl: string;
  readonly executable: string;
  readonly presentation: MpvPresentation;
  readonly integrationScript: string | null;
  readonly eventSink: MpvEventSink;
  child: ChildProcess | null = null;
  socket: net.Socket | null = null;
  buffer = "";
  nextRequestId = 1;
  pending = new Map<number, PendingCommand>();
  starting: Promise<void> | null = null;
  closing = false;
  current = false;
  replacing = false;
  pendingLoad: MpvLoadRequest | null = null;
  lastProcessError: Error | null = null;
  ipcPath: string | null = null;

  constructor({
    serverUrl,
    executable = "mpv",
    presentation = "jellyfin",
    integrationScript = DEFAULT_INTEGRATION_SCRIPT,
    eventSink = () => {},
  }: MpvControllerOptions) {
    this.serverUrl = serverUrl;
    this.executable = executable;
    this.presentation = normalizeMpvPresentation(presentation);
    this.integrationScript = integrationScript;
    this.eventSink = eventSink;
  }

  get ready(): boolean {
    return Boolean(this.child && this.socket && this.child.exitCode == null);
  }

  status(): MpvStatus {
    return {
      backend: "mpv",
      available: true,
      ready: this.ready,
      executable: this.executable,
      presentation: this.presentation,
      reason: this.lastProcessError ? this.lastProcessError.message : "",
    };
  }

  emit(event: MpvEventName, payload: MpvEventPayload = {}): void {
    try {
      this.eventSink(event, payload);
    } catch (error: unknown) {
      console.warn(`[Deskfin] MPV event sink failed for ${event}:`, error);
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.ready) return;
    if (this.closing) throw new Error("MPV controller is closing");
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  }

  async start(): Promise<void> {
    this.teardownConnection();
    this.lastProcessError = null;
    this.ipcPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\jellyfin-dc-electron-${process.pid}-${crypto.randomUUID()}`
        : path.join(
            os.tmpdir(),
            `jellyfin-dc-electron-${process.pid}-${crypto.randomUUID()}.sock`,
          );

    if (this.integrationScript && !fs.existsSync(this.integrationScript)) {
      throw new Error(
        `MPV integration script is missing: ${this.integrationScript}`,
      );
    }
    const args = buildMpvArguments(
      this.ipcPath,
      this.presentation,
      this.integrationScript,
    );
    const child = spawn(this.executable, args, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    this.child = child;
    child.once("error", (error) => this.onProcessError(child, error));
    child.once("exit", (code, signal) =>
      this.onProcessExit(child, code, signal),
    );

    const deadline = Date.now() + START_TIMEOUT_MS;
    let lastConnectionError: unknown = null;
    while (
      Date.now() < deadline &&
      child.exitCode == null &&
      !this.lastProcessError
    ) {
      try {
        this.socket = await connectOnce(this.ipcPath);
        break;
      } catch (error: unknown) {
        lastConnectionError = error;
        await delay(50);
      }
    }

    if (!this.socket) {
      this.terminateProcess();
      const reason =
        this.lastProcessError ||
        lastConnectionError ||
        new Error("MPV did not start");
      throw new Error(`Could not start MPV: ${errorMessage(reason)}`);
    }

    this.attachSocket(this.socket);
    const properties = [
      "time-pos",
      "duration",
      "pause",
      "volume",
      "mute",
      "speed",
      "fullscreen",
      "aid",
      "sid",
    ];
    await Promise.all(
      properties.map((name, index) =>
        this.command(["observe_property", index + 1, name]),
      ),
    );
    this.emit("ready", { ready: true });
  }

  attachSocket(socket: net.Socket): void {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.onSocketData(chunk));
    socket.on("error", (error) => {
      if (!this.closing) {
        this.onSocketFailure(
          socket,
          new Error(`MPV IPC failed: ${error.message}`),
        );
      }
    });
    socket.on("close", () => {
      if (this.socket === socket && !this.closing) {
        this.onSocketFailure(socket, new Error("MPV IPC closed"));
      }
    });
  }

  onSocketFailure(socket: net.Socket, error: Error): void {
    if (this.socket !== socket) return;
    this.lastProcessError = error;
    this.socket = null;
    socket.destroy();
    this.failPending(error);
    this.terminateProcess();
    this.removeSocketFile();
  }

  onSocketData(chunk: string | Buffer): void {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          this.onMessage(JSON.parse(line));
        } catch (error: unknown) {
          console.warn("[Deskfin] Ignoring malformed MPV IPC message:", error);
        }
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  onMessage(rawMessage: unknown): void {
    if (!isRecord(rawMessage)) return;
    const message = rawMessage;
    if (
      typeof message.request_id === "number" &&
      Number.isInteger(message.request_id)
    ) {
      const pending = this.pending.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.request_id);
        if (message.error && message.error !== "success") {
          pending.reject(new Error(`MPV command failed: ${message.error}`));
        } else {
          pending.resolve(message.data);
        }
      }
    }

    if (typeof message.event !== "string") return;
    if (message.event === "client-message") {
      const args = Array.isArray(message.args) ? message.args : [];
      const namespace = args[0];
      const action = args[1];
      if (
        namespace === "jellyfin-dc-control" &&
        (action === "next" || action === "previous")
      ) {
        this.emit(action);
      }
      return;
    }
    if (message.event === "file-loaded") {
      this.replacing = false;
      void this.applySelectedTracks();
      return;
    }
    if (message.event === "end-file") {
      if (message.reason === "stop" && this.replacing) return;
      const wasCurrent = this.current;
      this.current = false;
      this.replacing = false;
      this.pendingLoad = null;
      if (!wasCurrent) return;
      if (message.reason === "error") {
        this.emit("failed", {
          code: "media",
          message: String(message.file_error || "MPV could not load the media"),
        });
      } else if (message.reason === "eof") {
        this.emit("ended");
      } else if (message.reason === "quit") {
        this.emit("quit");
      }
      return;
    }
    if (message.event === "property-change" && message.data != null) {
      const names: Record<string, MpvEventName> = {
        "time-pos": "position",
        duration: "duration",
        pause: "paused",
        volume: "volume",
        mute: "muted",
        speed: "rate",
        fullscreen: "fullscreen",
        aid: "audioTrack",
        sid: "subtitleTrack",
      };
      const event =
        typeof message.name === "string" ? names[message.name] : null;
      if (event) this.emit(event, { value: message.data });
    }
  }

  async applySelectedTracks(): Promise<void> {
    const request = this.pendingLoad;
    if (!request || !this.ready) return;
    try {
      if (request.externalAudioUrl) {
        await this.command(["audio-add", request.externalAudioUrl, "select"]);
      } else {
        await this.command(["set_property", "aid", request.audioTrack]);
      }
      if (request.externalSubtitleUrl) {
        await this.command(["sub-add", request.externalSubtitleUrl, "select"]);
      } else {
        await this.command(["set_property", "sid", request.subtitleTrack]);
      }
      this.emit("loaded");
      if (this.presentation === "jellyfin") {
        const message = request.title
          ? `Jellyfin\n${request.title}`
          : "Jellyfin";
        this.command(["show-text", message, 2200]).catch((error: unknown) => {
          console.warn(
            "[Deskfin] Could not show MPV playback title:",
            errorMessage(error),
          );
        });
      }
    } catch (error: unknown) {
      this.emit("failed", { code: "tracks", message: errorMessage(error) });
    }
  }

  command(command: MpvCommand): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error("MPV is not ready"));
    }
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("MPV command timed out"));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      socket.write(
        `${JSON.stringify({ command, request_id: requestId })}\n`,
        (error) => {
          if (!error) return;
          clearTimeout(timer);
          this.pending.delete(requestId);
          this.onSocketFailure(socket, error);
          reject(error);
        },
      );
    });
  }

  async loadRequest(request: MpvLoadRequest): Promise<true> {
    await this.ensureStarted();
    await this.command(["set_property", "fullscreen", request.fullscreen]);
    await this.command(["set_property", "pause", false]);
    await this.command(["set_property", "force-media-title", request.title]);
    this.pendingLoad = request;
    this.current = true;
    this.replacing = true;
    try {
      await this.command([
        "loadfile",
        request.url,
        "replace",
        -1,
        `start=${request.startSeconds.toFixed(3)}`,
      ]);
    } catch (error: unknown) {
      this.pendingLoad = null;
      this.current = false;
      this.replacing = false;
      throw error;
    }
    return true;
  }

  async load(value: unknown): Promise<true> {
    const request = normalizeLoadRequest(value, this.serverUrl);
    try {
      return await this.loadRequest(request);
    } catch (error: unknown) {
      if (this.closing || !canRetryLoad(error)) throw error;
      console.warn(
        "[Deskfin] MPV connection was lost while loading; restarting it once.",
      );
      this.teardownConnection();
      return this.loadRequest(request);
    }
  }

  async execute(name: string, value?: unknown): Promise<true> {
    if (name === "stop" && !this.ready) {
      this.current = false;
      this.replacing = false;
      this.pendingLoad = null;
      return true;
    }
    await this.ensureStarted();
    const commands: Record<string, () => MpvCommand> = {
      play: () => ["osd-auto", "set", "pause", "no"],
      pause: () => ["osd-auto", "set", "pause", "yes"],
      stop: () => ["stop"],
      seek: () => [
        "osd-auto",
        "seek",
        String(numberInRange(value, "position", 0, 315360000)),
        "absolute",
      ],
      volume: () => [
        "osd-auto",
        "set",
        "volume",
        String(numberInRange(value, "volume", 0, 100)),
      ],
      rate: () => [
        "osd-auto",
        "set",
        "speed",
        String(numberInRange(value, "rate", 0.25, 4)),
      ],
      audioTrack: () => {
        const track = trackNumber(value, "audioTrack");
        return ["osd-auto", "set", "aid", track === 0 ? "no" : String(track)];
      },
      subtitleTrack: () => {
        const track = trackNumber(value, "subtitleTrack");
        return ["osd-auto", "set", "sid", track === 0 ? "no" : String(track)];
      },
    };
    if (name === "muted" || name === "fullscreen") {
      if (typeof value !== "boolean") {
        throw new Error(`${name} must be a boolean`);
      }
      if (name === "muted") {
        await this.command(["osd-auto", "set", "mute", value ? "yes" : "no"]);
      } else {
        await this.command(["set_property", "fullscreen", value]);
      }
      return true;
    }
    const makeCommand = commands[name];
    if (!makeCommand) throw new Error(`Unsupported MPV command: ${name}`);
    if (name === "stop") {
      this.current = false;
      this.replacing = false;
      this.pendingLoad = null;
    }
    await this.command(makeCommand());
    return true;
  }

  onProcessError(child: ChildProcess, error: Error): void {
    if (this.child !== child) return;
    this.lastProcessError = error;
    this.failPending(error);
  }

  onProcessExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) return;
    const wasCurrent = this.current;
    const wasClosing = this.closing;
    this.child = null;
    this.current = false;
    this.replacing = false;
    this.pendingLoad = null;
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.failPending(new Error(`MPV exited (${signal ?? code ?? "unknown"})`));
    this.removeSocketFile();
    this.emit("ready", { ready: false });
    if (wasCurrent && !wasClosing) {
      if (code === 0 && signal == null) {
        this.emit("quit");
      } else {
        this.emit("failed", {
          code: "process",
          message: `MPV exited unexpectedly (${signal ?? code ?? "unknown"})`,
        });
      }
    }
  }

  failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  teardownConnection(): void {
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.buffer = "";
    this.failPending(new Error("MPV connection was replaced"));
    this.terminateProcess();
    this.removeSocketFile();
  }

  terminateProcess(): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode == null) child.kill();
  }

  removeSocketFile(): void {
    if (process.platform !== "win32" && this.ipcPath) {
      try {
        fs.unlinkSync(this.ipcPath);
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOENT") {
          console.warn("[Deskfin] Could not remove MPV socket:", error);
        }
      }
    }
    this.ipcPath = null;
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.current = false;
    this.replacing = false;
    this.pendingLoad = null;
    this.teardownConnection();
    this.emit("ready", { ready: false });
  }
}
