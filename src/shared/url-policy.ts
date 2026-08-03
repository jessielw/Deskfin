export function normalizeServerUrl(rawValue: unknown): string {
  let value = String(rawValue || "").trim();
  if (!value) throw new Error("A Jellyfin server URL is required");
  if (!value.includes("://")) value = `http://${value}`;

  const candidate = new URL(value);
  if (!["http:", "https:"].includes(candidate.protocol)) {
    throw new Error("The Jellyfin server URL must use HTTP or HTTPS");
  }
  if (candidate.username || candidate.password) {
    throw new Error("Do not include credentials in the Jellyfin server URL");
  }
  if (candidate.search || candidate.hash) {
    throw new Error("The Jellyfin server URL cannot contain a query or fragment");
  }

  candidate.pathname = candidate.pathname
    .replace(/\/web(?:\/index\.html)?\/?$/i, "")
    .replace(/\/$/, "");
  return candidate.href.replace(/\/$/, "");
}

export function serverBasePath(serverUrl: string): string {
  return new URL(normalizeServerUrl(serverUrl)).pathname.replace(/\/$/, "");
}

export function isWithinServer(rawUrl: string, serverUrl: string): boolean {
  try {
    const candidate = new URL(rawUrl);
    const server = new URL(normalizeServerUrl(serverUrl));
    if (candidate.origin !== server.origin) return false;
    const basePath = server.pathname.replace(/\/$/, "");
    return (
      !basePath ||
      candidate.pathname === basePath ||
      candidate.pathname.startsWith(`${basePath}/`)
    );
  } catch {
    return false;
  }
}

export function validateMediaUrl(rawUrl: unknown, serverUrl: string): string {
  if (typeof rawUrl !== "string" || !rawUrl) {
    throw new Error("A media URL is required");
  }
  if (!isWithinServer(rawUrl, serverUrl)) {
    throw new Error("The media URL is outside the configured Jellyfin server");
  }
  const candidate = new URL(rawUrl);
  if (!["http:", "https:"].includes(candidate.protocol)) {
    throw new Error("The media URL must use HTTP or HTTPS");
  }
  return candidate.href;
}

const SENSITIVE_PAGE_PARAMETER_NAMES = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "password",
  "token",
  "xembyauthorization",
  "xembytoken",
  "xmediabrowsertoken",
]);

function normalizedParameterName(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "");
}

function removeSensitiveParameters(parameters: URLSearchParams): void {
  for (const name of [...parameters.keys()]) {
    if (SENSITIVE_PAGE_PARAMETER_NAMES.has(normalizedParameterName(name))) {
      parameters.delete(name);
    }
  }
}

function sanitizePageHash(hash: string): string {
  if (!hash) return "";
  const value = hash.slice(1);
  const queryIndex = value.indexOf("?");
  if (queryIndex >= 0) {
    const route = value.slice(0, queryIndex);
    const parameters = new URLSearchParams(value.slice(queryIndex + 1));
    removeSensitiveParameters(parameters);
    const query = parameters.toString();
    return `#${route}${query ? `?${query}` : ""}`;
  }

  if (/^[^/?#=&]+=/.test(value)) {
    const parameters = new URLSearchParams(value);
    removeSensitiveParameters(parameters);
    const query = parameters.toString();
    return query ? `#${query}` : "";
  }
  return hash;
}

export function safeJellyfinPageUrl(rawUrl: unknown, serverUrl: string): string {
  if (typeof rawUrl !== "string" || !rawUrl) {
    throw new Error("A Jellyfin page URL is required");
  }
  if (!isWithinServer(rawUrl, serverUrl)) {
    throw new Error("The page URL is outside the configured Jellyfin server");
  }

  const candidate = new URL(rawUrl);
  if (!["http:", "https:"].includes(candidate.protocol)) {
    throw new Error("The page URL must use HTTP or HTTPS");
  }
  candidate.username = "";
  candidate.password = "";
  removeSensitiveParameters(candidate.searchParams);
  candidate.hash = sanitizePageHash(candidate.hash);
  return candidate.href;
}
