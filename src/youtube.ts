export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Default timeout (ms) for each request to the YouTube API. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Reads `DEBUG=yt-mcp` to enable per-request logging to stderr. */
const debugEnabled =
  (process.env.DEBUG ?? "").split(",").includes("yt-mcp") ||
  process.env.DEBUG === "true";

function log(...args: unknown[]) {
  if (debugEnabled) console.error("[yt-mcp]", ...args);
}

/** OAuth2 scopes required for write tools and `mine=true`. */
export const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtubepartner",
] as const;

export interface ApiErrorShape {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ message?: string; reason?: string; domain?: string }>;
  };
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason?: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

/**
 * Bundled request configuration for a single YouTube Data API call.
 */
export interface ApiConfig {
  /** Google API key. Used when no OAuth access token is provided. */
  apiKey?: string;
  /** OAuth2 access token. Required for writes and `mine=true`. */
  accessToken?: string;
}

/**
 * Minimal typed HTTP client for the YouTube Data API v3.
 * Used in place of googleapis so the server stays lean and dependency-free
 * beyond the MCP SDK.
 */
export class YouTubeClient {
  constructor(private readonly config: ApiConfig) {}

  get hasAccessToken(): boolean {
    return Boolean(this.config.accessToken);
  }

  /**
   * Perform a request. `params` are URL query parameters, `body` is the JSON
   * request body (omit for GET/DELETE). Returns the parsed JSON response.
   */
  async request<T = unknown>(options: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  }): Promise<T> {
    const { method, path, params = {}, body } = options;

    // Write calls always require OAuth2; authenticate with the access token
    // only. Making this explicit (not an `else if` on the key) avoids silently
    // falling back to the API key if the branches are reordered. Read calls
    // (`mine=true` needs OAuth too, enforced by the handler) may use an API key.
    const writing = method === "POST" || method === "PUT" || method === "DELETE";
    if (writing && !this.config.accessToken) {
      throw new YouTubeApiError(
        `${method} ${path} requires OAuth2 auth. Set YOUTUBE_ACCESS_TOKEN (API keys cannot write to the YouTube Data API).`,
        401,
        "authRequired",
      );
    }
    if (!this.config.apiKey && !this.config.accessToken) {
      throw new YouTubeApiError(
        "No credentials configured. Set YOUTUBE_API_KEY (for public reads) or YOUTUBE_ACCESS_TOKEN (for writes and mine=true).",
        401,
        "authMissing",
      );
    }

    const url = new URL(`${YOUTUBE_API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.config.accessToken) {
      headers.Authorization = `Bearer ${this.config.accessToken}`;
    } else if (this.config.apiKey) {
      url.searchParams.set("key", this.config.apiKey);
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    } else if (method === "POST" || method === "PUT") {
      throw new YouTubeApiError(
        `${method} ${path} requires a request body.`,
        400,
        "bodyRequired",
      );
    }

    let res: Response;
    log(`${method} ${path}`, Object.fromEntries(url.searchParams));
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      log(`  -> ${res.status} ${res.statusText}`);
    } catch (err) {
      throw new YouTubeApiError(
        `Network error calling ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
        0,
        "networkError",
      );
    }

    // 204 No Content (delete calls).
    if (res.status === 204) {
      return { ok: true } as T;
    }

    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const errData = (data ?? {}) as ApiErrorShape;
      const errors = errData.error?.errors ?? [];
      const first = errors[0];
      const message =
        errData.error?.message ??
        first?.message ??
        `YouTube Data API request failed with status ${res.status}`;
      // Keep `reason` undefined rather than stuffing the HTTP code in when the
      // per-error reason is absent, and surface all errors (YouTube can return
      // several for one request), not just the first.
      throw new YouTubeApiError(
        message,
        res.status,
        first?.reason,
        {
          ...errData,
          errors,
        },
      );
    }

    return data as T;
  }
}