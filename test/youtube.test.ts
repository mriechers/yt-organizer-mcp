import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  YouTubeClient,
  YouTubeApiError,
  YOUTUBE_API_BASE,
} from "../src/youtube.js";

function mockFetchResponse(
  init: ResponseInit & { body?: unknown },
): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  let bodyText: string | undefined;
  if (init.body !== undefined) {
    bodyText = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }
  mock.mockResolvedValue(
    new Response(bodyText as BodyInit | undefined, {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return mock;
}

describe("YouTubeClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires a valid credential", async () => {
    globalThis.fetch = mockFetchResponse({ status: 200, body: {} });
    const client = new YouTubeClient({});
    await expect(
      client.request({ method: "GET", path: "/playlists" }),
    ).rejects.toMatchObject({ reason: "authMissing", status: 401 });
  });

  it("uses the access token for writes", async () => {
    const fetchMock = mockFetchResponse({ status: 200, body: { ok: true } });
    globalThis.fetch = fetchMock;

    const client = new YouTubeClient({ accessToken: "tok" });
    await client.request({
      method: "POST",
      path: "/playlists",
      body: { kind: "x" },
      params: { part: "snippet" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(String(url)).not.toContain("key=");
    expect(init.body).toBe(JSON.stringify({ kind: "x" }));
  });

  it("rejects writes without an access token even if an API key is set", async () => {
    globalThis.fetch = mockFetchResponse({ status: 200, body: {} });
    const client = new YouTubeClient({ apiKey: "k" });
    await expect(
      client.request({ method: "POST", path: "/playlists", body: {} }),
    ).rejects.toMatchObject({ reason: "authRequired", status: 401 });
  });

  it("uses the API key for read calls", async () => {
    const fetchMock = mockFetchResponse({ status: 200, body: { items: [] } });
    globalThis.fetch = fetchMock;
    const client = new YouTubeClient({ apiKey: "k" });
    await client.request({ method: "GET", path: "/playlists" });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("key=k");
  });

  it("maps an API error, surfacing all sub-errors", async () => {
    globalThis.fetch = mockFetchResponse({
      status: 400,
      body: {
        error: {
          code: 400,
          message: "Bad",
          errors: [
            { message: "a", reason: "r1" },
            { message: "b", reason: "r2" },
          ],
        },
      },
    });
    const client = new YouTubeClient({ apiKey: "k" });
    const err = await client
      .request({ method: "GET", path: "/playlists" })
      .catch((e) => e as YouTubeApiError);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect(err.status).toBe(400);
    expect(err.reason).toBe("r1");
    expect(err.detail).toMatchObject({
      errors: [
        { message: "a", reason: "r1" },
        { message: "b", reason: "r2" },
      ],
    });
  });

  it("treats 204 as a success envelope", async () => {
    globalThis.fetch = mockFetchResponse({ status: 204 });
    const client = new YouTubeClient({ accessToken: "tok" });
    await expect(
      client.request({ method: "DELETE", path: "/playlists", params: { id: "x" } }),
    ).resolves.toEqual({ ok: true });
  });

  it("uses the configured base URL", async () => {
    const fetchMock = mockFetchResponse({ status: 200, body: { items: [] } });
    globalThis.fetch = fetchMock;
    const client = new YouTubeClient({ apiKey: "k" });
    await client.request({ method: "GET", path: "/playlists" });
    expect(String(fetchMock.mock.calls[0][0]).startsWith(YOUTUBE_API_BASE)).toBe(
      true,
    );
  });
});