# Project Review — yt-playlist-organizer-mcp

Overall: a small, focused, well-scoped MCP server. It does exactly what the
README says — create/list/update/delete playlists and playlist items via the
YouTube Data API v3 — and nothing else. Code is readable, TS strict mode is on,
and the build passes `tsc --noEmit` cleanly. That said, there are several real
bugs, dependency inconsistencies, and a few design choices worth revisiting.

Findings are grouped by severity. Line numbers reference files in `src/`.

---

## Critical (bugs / breakage)

### 1. `zod` is not declared as a dependency in `package.json`
`src/playlists.ts:1`, `src/playlistItems.ts:1`, `src/types.ts:1` all
`import { z } from "zod"` directly. But `package.json` only lists
`@modelcontextprotocol/sdk` and `zod` is **not** in the `dependencies` map.
Zod is currently only resolvable because the MCP SDK happens to pull it in
transitively (zod 4.4.3 shows up in `node_modules/zod` via the SDK's subtree).
Meanwhile `package.json` declares `zod` version `^3.23.8` in
`devDependencies`? No — it actually declares it nowhere; the `devDependencies`
only list `@types/node` and `typescript`.

Two concrete problems:
- `npm install --omit=optional` or a future SDK that drops zod will silently
  break this server at runtime.
- `src/types.ts:7` uses `z.ZodObject<z.ZodRawShape>`, which is a **zod v4** API.
  `package.json` (README/mental model) assumes zod v3. If zod is ever pinned to
  v3 explicitly, `ToolSchema` will fail to typecheck.

Fix: add `"zod": "^4.4.3"` (or `^3.23.8` after migrating the `ZodRawShape`
type) to `dependencies` in `package.json` and regenerate `package-lock.json`.

### 2. `registerTool` is given a `ToolSchema` but the SDK expects a raw shape
`src/index.ts:47` casts `tool.schema as ToolSchema` where `ToolSchema` is
`z.ZodObject<z.ZodRawShape>`. `McpServer.registerTool`'s `inputSchema` expects
the **raw shape object** (the object passed to `z.object({...})`), not the
constructed `ZodObject` instance. Casting a `ZodObject` instance to the shape
type and handing it in will either (a) be accepted at compile-time via the
cast and silently misbehave at runtime, or (b) produce schema validation
errors when the client sends args. Verify against the installed SDK's
`registerTool` signature; if it needs the raw shape, store the shape on
`ToolDefinition` (or call `.shape` / pass the shape literal) instead of the
`ZodObject`.

### 3. `.refine()` on list schemas never surfaces a useful error
`src/playlists.ts:79-82` and `src/playlistItems.ts:60-63` use
`.refine(..., "Specify exactly one filter: ...")`. With the current arg path
(`index.ts:48` passes `(args ?? {}) as Record<string, unknown>` directly to
`tool.handler`, bypassing zod parse), the refine predicate is **never
evaluated**. The handlers then fall through to the YouTube API, which returns
an opaque 400. Either:
- Parse args through the schema (`schema.parse(args)`) before calling the
  handler, or
- Drop the `.refine()` and replicate the check in the handler.

Right now the validation advertised in the README ("input validation rejects
the call") does not actually run for the "exactly one filter" rule.

### 4. Zod schemas are constructed but never used for parsing
Beyond the refine issue above, none of the handlers call `.parse()` /
`.safeParse()` on `args`. The zod schemas are used only for the tool metadata
sent to the client. Inside the handler, every field is manually re-validated
with `String(args.x ?? "")` patterns. This means:
- `min(0).max(50)` on `maxResults` is not enforced.
- `.max(280)` on `note` is not enforced.
- Defaults declared with `.default(...)` are not applied (the handler reads
  `args.part ?? "..."` separately, so the zod default is dead code).
- Enum validation on `privacyStatus` is not enforced.

Fix: `const a = tool.schema.parse(args)` in the handler (or in the
`index.ts` wrapper before calling the handler) and use `a` throughout. This
also fixes #3.

### 5. `mine=true` auth check is inconsistent with reads
`src/playlists.ts:89` throws a JS `Error` when `mine === true` and there's no
access token, but the README and YouTube semantics say an API key is the
*wrong* credential for `mine=true` regardless. Fine. But the same handler
then lets `client.request` add the `Bearer` header *or* the `key` param —
never both — see `youtube.ts:80-84`: it's `if (accessToken) ... else if
(apiKey)`. So if the user sets both env vars and calls `mine=true` without an
access token, the error message is correct but the design is brittle: a
future change that reorders these branches will silently fall back to the
API key and 403. Recommend making the auth preconditions explicit per-tool
(read vs. write vs. `mine`) at the `YouTubeClient`/handler boundary rather
than relying on the `else if` ordering.

### 6. `playlists_update` always sends `status.privacyStatus`, clobbering it
`src/playlists.ts:223` unconditionally sets
`status: { privacyStatus: String(args.privacyStatus ?? "private") }`. So a
user calling `playlists_update` to rename a playlist will silently reset
`privacyStatus` to `private` if they didn't pass it. The YouTube API's
"omitted snippet fields are cleared" semantics make this worse: an existing
`unlisted` playlist renamed via this tool becomes `private` without warning.
Either omit `status` from the body when `privacyStatus` is not provided, or
document loudly that this tool always overrides `privacyStatus` and defaults
to `private`.

### 7. `playlists_update` strips `description` on every call
Same root cause: the body always includes `snippet: { title }`, and
`description` is only added if explicitly passed
(`playlists.ts:226`). Per YouTube API semantics, an omitted `description`
**clears** it. So updating a title deletes the playlist description. This is
documented in the README ("omitted snippet fields are cleared") but the
default `part` is `snippet,status` and there's no guard. Either:
- Require `description` to be passed, or
- Read-then-write (fetch existing snippet, merge, PUT), or
- At minimum surface this in the tool description so the LLM/user knows to
  pass the existing description.

### 8. `playlistItems_update` has the same clobber problem
`src/playlistItems.ts:219-238` rebuilds the snippet from `playlistId`,
`videoId`, and optionally `position`. Any other snippet fields the API
tracks are dropped. Same for `contentDetails` (`startAt`/`endAt`/`note`):
omitting them on an update clears existing values. Document or
read-then-write.

### 9. `startAt`/`endAt` formatting is wrong
`src/playlistItems.ts:148-149` and `:233-234` emit `${startAt}s` (e.g. `"90s"`).
The YouTube Data API `contentDetails.startAt`/`endAt` expects an **ISO 8601
duration** (`PT1M30S`), not `"<seconds>s"`. This will be rejected or
misinterpreted. Convert to `PT...H...M...S` before sending.

---

## High (correctness / DX)

### 10. No tests
There is no test setup, no test script, no test files. Given that the handlers
contain real validation logic and body-shaping logic (parts, snippet
construction, contentDetails), this is a meaningful gap. A few vitest/jest
unit tests with a mocked `YouTubeClient` (or `fetch`) would catch all of the
bugs above before they ship.

### 11. `package.json` `name` vs README `title` vs `package-lock.json` `name`
- `package.json`: `"name": "yt-playlist-organizer-mcp"`
- `package-lock.json`: `"name": "yt-data-api-mcp"` (line 2)
- README H1: `yt-playlist-organizer-mcp`
- `flake.nix` description: `yt-data-api-mcp`
- opencode config block: `yt-playlist-organizer-mcp`

The lockfile still references the old `yt-data-api-mcp` name. Regenerate the
lockfile (`rm package-lock.json && npm install`) so the package name is
consistent across all files.

### 12. `SCOPES` is exported but never used
`src/youtube.ts:3-8` defines `SCOPES` (and includes `youtube.readonly`, which
the README's scope list omits). Nothing imports it. Either:
- Wire it into `auth_status` so the tool can report required scopes, or
- Remove it.

### 13. `auth_status` is registered with no `inputSchema`
`src/index.ts:86-87` calls `server.registerTool("auth_status", { description })`
without an `inputSchema`. Depending on the SDK version this is either
tolerated (treated as empty object) or it's a protocol violation. Pass an
explicit `z.object({})` to be safe and future-proof.

### 14. Errors from non-API code paths are re-thrown, not returned
`src/index.ts:76-78` re-throws non-`YouTubeApiError` errors. The MCP runtime
then surfaces them as transport-level failures. For consistency and a better
client experience, wrap unexpected errors into an `isError: true` response
too (with a `type: "text"` content) rather than only handling
`YouTubeApiError`.

### 15. `playlistDelete` / `playlistItemsDelete` return `{ success, message, result }`
`src/playlists.ts:261` and `src/playlistItems.ts:281` wrap the `204` body
(`{ ok: true }` synthesized in `youtube.ts:106`) into
`{ success: true, message, result: { ok: true } }`. That's fine but
inconsistent with the list/insert/update handlers, which return the raw API
response. Pick one shape and apply it everywhere.

### 16. `playlists_list` and `playlistItems_list` throw on missing `items`
`src/playlists.ts:110-112` / `src/playlistItems.ts:84-86` throw
`"The API returned no items array."` if `items` is undefined. The API
legitimately returns `{ items: [] }` for empty results, but `items` can also
be absent on certain error-shaped 2xx responses. Throwing here is probably
fine, but the message is misleading — it's not always an error. Consider
returning `items ?? []` (or the full response and let the caller decide).

---

## Medium (design / maintainability)

### 17. Duplicated `parseParts` function
`src/playlists.ts:14-27` and `src/playlistItems.ts:7-20` are byte-for-byte
identical. Move to a shared module (e.g. `src/parts.ts` or into `youtube.ts`).

### 18. Duplicated `onBehalfOfContentOwner*` plumbing
Every schema repeats the two `onBehalfOfContentOwner*` fields verbatim, and
every handler re-casts them. Extract a `onBehalfOfFields()` zod helper and a
small `pickOnBehalfOf(args)` helper, or drop these fields entirely if you
don't actually use YouTube Partners features — the README never mentions
them and they add noise to every tool signature.

### 19. Handlers do `args as Record<string, string | number | boolean | undefined>` for no benefit
`src/playlists.ts:88`, `src/playlistItems.ts:69`. Once #4 is fixed (parse
through zod), this cast disappears and the handlers get typed args for free.

### 20. `YouTubeClient.request` keys body-undefined checks on `body !== undefined`
`src/youtube.ts:85-87`. That's correct, but `POST`/`PUT` with no body (which
shouldn't happen for these endpoints but could for a future one) will send no
`Content-Type`. Document or assert that `POST`/`PUT` require a body.

### 21. No request timeout / retry / rate-limit handling
`fetch` is called with no `AbortController` (`youtube.ts:91`). A hung YouTube
endpoint will hang the MCP client indefinitely. Add an `AbortSignal.timeout`
and optionally a single retry on 5xx/network errors. The YouTube API is also
quota-limited; surfacing `X-RateLimit-*` / quota info in the response would
help the LLM back off.

### 22. No structured logging / debug hook
`index.ts:111-113` only logs fatal startup errors. There's no way to see what
requests the server is making. A `DEBUG=yt-mcp:*` env-controlled logger (or
`console.error` behind a flag) would make this much easier to operate.

### 23. `dist/` is committed to git but also `.gitignore`'d
`.gitignore:2` ignores `dist/`, but `dist/` exists on disk and (per the env
note) the repo currently has no commits. If you intend to ship built JS,
decide one way: either commit `dist/` and remove it from `.gitignore`, or
don't commit it and rely on `npm run build` (preferred for an MCP server
installed via `npm`/`nix`). The current state is contradictory.

### 24. `engines.node >= 18` vs `target: ES2022` and Node 22 in nix
`package.json` allows Node 18+, `tsconfig.json` targets `ES2022`, the nix
shells provide `nodejs_22`. `fetch`, `AbortSignal.timeout`, and the SDK's own
`engines` (the SDK's `@hono/node-server` peer wants `node >=20`) all push the
real floor higher than 18. Bump `engines.node` to `>=20` (or `>=22`) to match
reality and the dev shell.

### 25. `flake.nix` pins `nixos-26.05`
`flake.nix:5` pins `github:NixOS/nixpkgs/nixos-26.05`. As of today that branch
does not exist (nixpkgs branches are `nixos-25.05`, `nixos-unstable`, etc.).
This flake will fail to evaluate on a fresh machine. Pin to an existing
branch (e.g. `nixos-25.05` or `nixpkgs-unstable`) and/or use a `flake.lock`
that records a specific rev.

### 26. `shell.nix` doesn't pin `nodejs_22` to the same source as the flake
`shell.nix:9` uses `pkgs.nodejs_22` from `<nixpkgs>`, which is whatever the
user's channel happens to be. The flake pins a (currently invalid) branch.
The two can diverge. Consider pointing `shell.nix` at the same `nixpkgs`
revision as the flake, or dropping `shell.nix` entirely in favor of `nix
develop`.

### 27. README opencode config block hardcodes an absolute path
`README.md:99` ships with `/home/thibaultmol/Downloads/codex/organize-yt/yt-data-api-mcp/dist/index.js`.
Other people cloning this will have a different path. Use a placeholder
(`<path-to-repo>/dist/index.js`) or document an install-via-npm flow
(`npx yt-playlist-organizer-mcp`) so the path isn't needed.

### 28. README mentions `mine=true` requiring OAuth but the tool description omits it
`README.md:21` documents `mine=true`, but the `playlists_list` tool
description (`playlists.ts:270`) only mentions "Requires exactly one filter:
id, channelId, or mine=true." — it doesn't tell the LLM that `mine=true`
needs an OAuth token. The tool description is what the model actually sees;
move the auth precondition into the description.

---

## Low (nitpicks / polish)

### 29. `ApiErrorShape` swallows multi-error responses
`src/youtube.ts:10-16` only surfaces `errors[0]`. YouTube often returns
multiple errors per call (e.g. several invalid parts). Include all of them
in `YouTubeApiError.detail` and/or in the thrown message.

### 30. `YouTubeApiError.reason` falls back to `errData.error?.code?.toString()`
`src/youtube.ts:129`. `reason` is supposed to be a string like
`quotaExceeded`, not the HTTP code. If the per-error `reason` is missing,
leave `reason` undefined rather than stuffing the HTTP code in.

### 31. `.env.example` comment is stale
`.env.example:12`: "Now-unused placeholder tracks matching secrets accordingly."
This sentence doesn't parse and looks like a leftover from an earlier edit.
Rewrite or delete.

### 32. `README.md` "Run locally" uses `YOUTUBE_API_KEY=...` only
`README.md:88` shows `YOUTUBE_API_KEY=... node dist/index.js` as the local run
example, which only enables reads. Show both env vars, or explicitly say
"reads only".

### 33. `README.md` table column alignment
The Quota column in the Tools tables (`README.md:19-33`) is mis-aligned for
the DELETE rows (`DELETE| 50` has no space). Cosmetic, but it renders poorly
in some markdown tables.

### 34. `ToolDefinition.handler` returns `Promise<unknown>`
`src/types.ts:14`. The whole point of having a `YouTubeClient` with typed
`request<T>` is lost at the boundary. Consider a `ToolResult` discriminated
union so the `index.ts` wrapper doesn't have to `JSON.stringify` an
`unknown`.

### 35. No `LICENSE` file
README says MIT, `package.json` says MIT, but there's no `LICENSE` file in
the tree. Add one for it to be a valid MIT-licensed package.

### 36. No `CHANGELOG.md` / version pinning policy
v1.0.0 with no commits yet. Not urgent, but worth deciding before publishing.

### 37. `index.ts` tool registration loop is fine but could be a helper
`index.ts:44-82` is a 38-line loop that wraps every handler in the same
try/catch → JSON-stringify → error envelope logic. Extract a
`registerYouTubeTool(server, tool, client)` helper to make the registration
section a few lines and keep the error-handling contract in one place.

### 38. `main()` is not graceful-shutdown aware
`index.ts:108` connects the transport and then `main()` resolves. There's no
handling of `SIGINT`/`SIGTERM` to close the server cleanly. For an MCP
server spawned by a client this is usually fine (the client kills the
process), but adding a `process.on("SIGINT", () => server.close())` is cheap.

### 39. `description` in `McpServer` constructor is non-standard
`index.ts:29-31` passes a `description` field to `McpServer`'s server info.
The MCP `InitializeResult.serverInfo` schema has `name` and `version` only;
`description` is not part of it and will be ignored by most clients. Put the
description in the README / tool descriptions instead.

---

## Summary of must-fix items

1. Declare `zod` in `package.json` `dependencies` (#1).
2. Actually parse args through the zod schemas (#3, #4).
3. Stop clobbering `privacyStatus` / `description` on update (#6, #7, #8).
4. Fix `startAt`/`endAt` ISO 8601 duration formatting (#9).
5. Fix `flake.nix`'s `nixos-26.05` branch (#25).
6. Add at least a minimal test suite (#10).
7. Regenerate `package-lock.json` so the name matches (#11).
8. Verify `registerTool`'s expected `inputSchema` shape vs. the cast in
   `index.ts` (#2).

Everything else is polish. The core architecture (tiny typed HTTP client,
no `googleapis` bloat, one-tool-per-handler, zod schemas) is sound and a
good foundation to build the fixes on top of.
