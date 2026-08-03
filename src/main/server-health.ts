import { normalizeServerUrl } from "../shared/url-policy";

const DEFAULT_TIMEOUT_MS = 8000;
const PUBLIC_INFO_PATH = "/System/Info/Public";
const WEB_PATH = "/web/";

export interface JellyfinServerHealth {
  serverId: string;
  serverUrl: string;
  serverName: string;
  version: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface ValidationOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

class ServerValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function endpointUrl(serverUrl: string, endpoint: string): string {
  const candidate = new URL(normalizeServerUrl(serverUrl));
  const basePath = candidate.pathname.replace(/\/$/, "");
  candidate.pathname = `${basePath}${endpoint}`;
  candidate.search = "";
  candidate.hash = "";
  return candidate.href;
}

function baseFromPublicInfoUrl(responseUrl: string, fallback: string): string {
  try {
    const candidate = new URL(responseUrl);
    const suffix = /\/System\/Info\/Public\/?$/i;
    if (!suffix.test(candidate.pathname)) return fallback;
    candidate.pathname = candidate.pathname.replace(suffix, "");
    candidate.search = "";
    candidate.hash = "";
    return normalizeServerUrl(candidate.href);
  } catch {
    return fallback;
  }
}

function statusError(status: number, purpose: string): Error {
  if (status === 401 || status === 403) {
    return new ServerValidationError(
      `The server refused access to its public ${purpose}. Check its reverse-proxy and remote-access settings.`,
    );
  }
  if (status === 404) {
    return new ServerValidationError(
      `No Jellyfin ${purpose} was found at this address. Check the server URL and any reverse-proxy base path.`,
    );
  }
  return new ServerValidationError(
    `The server returned HTTP ${status} while checking its ${purpose}.`,
  );
}

function networkError(error: unknown, timeoutMs: number, timedOut: boolean): Error {
  if (
    timedOut ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new Error(
      `The Jellyfin server did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`,
    );
  }
  return new Error(
    "Could not reach the Jellyfin server. Check the address, DNS, network connection, and HTTPS certificate.",
    { cause: error },
  );
}

export async function validateJellyfinServer(
  rawServerUrl: unknown,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: ValidationOptions = {},
): Promise<JellyfinServerHealth> {
  const serverUrl = normalizeServerUrl(rawServerUrl);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const infoResponse = await fetchImpl(endpointUrl(serverUrl, PUBLIC_INFO_PATH), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!infoResponse.ok) {
      throw statusError(infoResponse.status, "server information endpoint");
    }

    let info: unknown;
    try {
      info = await infoResponse.json();
    } catch {
      throw new ServerValidationError(
        "The address responded, but it did not return valid Jellyfin server information.",
      );
    }
    if (
      !isRecord(info) ||
      info.ProductName !== "Jellyfin Server" ||
      typeof info.Id !== "string" ||
      !info.Id
    ) {
      throw new ServerValidationError(
        "The address responded, but it does not appear to be a Jellyfin server.",
      );
    }

    const canonicalServerUrl = baseFromPublicInfoUrl(infoResponse.url, serverUrl);
    const webResponse = await fetchImpl(endpointUrl(canonicalServerUrl, WEB_PATH), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    if (!webResponse.ok) {
      throw statusError(webResponse.status, "Web interface");
    }
    const contentType = webResponse.headers.get("content-type") || "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) {
      throw new ServerValidationError(
        "Jellyfin was found, but its Web interface returned an unexpected response.",
      );
    }

    return {
      serverId: info.Id,
      serverUrl: canonicalServerUrl,
      serverName:
        typeof info.ServerName === "string" && info.ServerName
          ? info.ServerName
          : "Jellyfin",
      version: typeof info.Version === "string" ? info.Version : "",
    };
  } catch (error: unknown) {
    if (error instanceof ServerValidationError) throw error;
    throw networkError(error, timeoutMs, timedOut);
  } finally {
    clearTimeout(timer);
  }
}
