import * as fs from "node:fs";
import * as path from "node:path";

export const WINDOW_STATE_VERSION = 1;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  version: number;
  bounds: WindowBounds;
  maximized: boolean;
  fullscreen: boolean;
}

interface WindowStateLogger {
  warn(...values: unknown[]): void;
}

interface LoadWindowStateOptions {
  logger?: WindowStateLogger;
}

interface WindowSizeLimits {
  minWidth: number;
  minHeight: number;
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

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function normalizeBounds(value: unknown): WindowBounds | null {
  if (!isRecord(value)) return null;
  const x = integer(value.x);
  const y = integer(value.y);
  const width = integer(value.width);
  const height = integer(value.height);
  if (x === null || y === null || width === null || height === null)
    return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function normalizeWindowState(value: unknown): WindowState | null {
  if (!isRecord(value) || value.version !== WINDOW_STATE_VERSION) return null;
  const bounds = normalizeBounds(value.bounds);
  if (!bounds) return null;
  return {
    version: WINDOW_STATE_VERSION,
    bounds,
    maximized: value.maximized === true,
    fullscreen: value.fullscreen === true,
  };
}

function intersectionArea(first: WindowBounds, second: WindowBounds): number {
  const width =
    Math.min(first.x + first.width, second.x + second.width) -
    Math.max(first.x, second.x);
  const height =
    Math.min(first.y + first.height, second.y + second.height) -
    Math.max(first.y, second.y);
  return Math.max(0, width) * Math.max(0, height);
}

function fitToWorkArea(
  bounds: WindowBounds,
  workArea: WindowBounds,
  { minWidth, minHeight }: WindowSizeLimits,
): WindowBounds {
  const width = Math.min(Math.max(bounds.width, minWidth), workArea.width);
  const height = Math.min(Math.max(bounds.height, minHeight), workArea.height);
  const maximumX = workArea.x + workArea.width - width;
  const maximumY = workArea.y + workArea.height - height;
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maximumX),
    y: Math.min(Math.max(bounds.y, workArea.y), maximumY),
    width,
    height,
  };
}

export function resolveWindowState(
  value: unknown,
  displayWorkAreas: WindowBounds[],
  limits: WindowSizeLimits,
): WindowState | null {
  const state = normalizeWindowState(value);
  if (!state) return null;

  let matchingWorkArea: WindowBounds | null = null;
  let largestIntersection = 0;
  for (const candidate of displayWorkAreas) {
    const workArea = normalizeBounds(candidate);
    if (!workArea) continue;
    const area = intersectionArea(state.bounds, workArea);
    if (area > largestIntersection) {
      matchingWorkArea = workArea;
      largestIntersection = area;
    }
  }
  if (!matchingWorkArea) return null;

  return {
    ...state,
    bounds: fitToWorkArea(state.bounds, matchingWorkArea, limits),
  };
}

export function loadWindowState(
  filePath: string,
  { logger = console }: LoadWindowStateOptions = {},
): WindowState | null {
  try {
    return normalizeWindowState(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") {
      logger.warn(
        `[Noktus] Could not read window state ${filePath}:`,
        errorMessage(error),
      );
    }
    return null;
  }
}

export function saveWindowState(filePath: string, value: unknown): WindowState {
  const state = normalizeWindowState(value);
  if (!state) throw new Error("A valid window state is required");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return state;
}
