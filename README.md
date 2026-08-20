# yt-playlist-organizer-mcp

An MCP server for **organizing YouTube playlists** via the
[YouTube Data API v3](https://developers.google.com/youtube/v3/docs).

It does exactly one thing and nothing more: **create, list, update, and delete
playlists and their playlist items**. It does not touch videos, channels,
captions, comments, subscriptions, or any other YouTube Data API resource.

Built with the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
and the YouTube Data API v3 REST endpoints (no heavy `googleapis` dependency).

## Tools

Everything this server does. There are no other tools.

### Playlists (`/playlists`)

| Tool                 | HTTP    | Quota | Description                                            |
| -------------------- | ------- | ----- | ------------------------------------------------------ |
| `playlists_list`     | GET     | 1     | List playlists by `id`, `channelId`, or `mine=true`.   |
| `playlists_insert`   | POST    | 50    | Create a playlist (requires `title`).                  |
| `playlists_update`   | PUT     | 50    | Modify a playlist (requires `id` + `title`).           |
| `playlists_delete`   | DELETE  | 50    | Delete a playlist (requires `id`).                     |

### PlaylistItems (`/playlistItems`)

| Tool                    | HTTP    | Quota | Description                                          |
| ----------------------- | ------- | ----- | ---------------------------------------------------- |
| `playlistItems_list`    | GET     | 1     | List items by `playlistId` or `id`.                  |
| `playlistItems_insert`  | POST    | 50    | Add a `videoId` to a `playlistId`.                   |
| `playlistItems_update`  | PUT     | 50    | Modify a playlist item (e.g. its `position`).        |
| `playlistItems_delete`  | DELETE  | 50    | Remove a playlist item (requires `id`).              |

Plus `auth_status` to check which credentials are configured.

## Configuration

This server only ever calls the `/playlists` and `/playlistItems` endpoints.
The rest of the YouTube Data API is out of scope.

The server reads two environment variables:

| Variable                 | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `YOUTUBE_API_KEY`        | Google API key. Enables public reads (`playlists_list`, `playlistItems_list`). |
| `YOUTUBE_ACCESS_TOKEN`   | OAuth2 access token. Required for write tools and `mine=true`.             |

See `.env.example`.

- **Reads** (`..._list`) work with just an API key (or an access token).
- **Writes** (`insert`/`update`/`delete`) and `mine=true` **require** an OAuth2
  access token with the scopes `youtube`, `youtube.force-ssl`, or
  `youtubepartner`.

## Getting OAuth2 credentials

1. Create a project in [Google Cloud Console](https://console.cloud.google.com).
2. Enable the **YouTube Data API v3**.
3. Create an OAuth2 client ID (Desktop app) and download the JSON.
4. Exchange credentials for an access token (e.g. via `google-auth-oauthlib` on
   Python, or a local OAuth flow service). Set `YOUTUBE_ACCESS_TOKEN=<token>`.
5. (Optional) Create an API key for simpler read-only use.

## Nix

This is NixOS-friendly. Both a flake and a `shell.nix` are provided.

```sh
# Enter the dev shell (node + typescript toolchain)
nix develop

# or, non-flake:
nix-shell
```

### Build

```sh
npm install        # install node deps (zod + MCP SDK)
npm run build      # emits dist/
npm run typecheck  # tsc --noEmit
```

### Run locally

```sh
# Reads only (API key):
YOUTUBE_API_KEY=... node dist/index.js

# Reads + writes/mine (OAuth access token):
YOUTUBE_ACCESS_TOKEN=... node dist/index.js
```

## Wiring into opencode

Add the following to `~/.config/opencode/opencode.jsonc` under `mcp`:

```jsonc
"mcp": {
  "yt-playlist-organizer-mcp": {
    "type": "local",
    "command": ["node", "<path-to-repo>/dist/index.js"],
    "enabled": true,
    "environment": {
      "YOUTUBE_API_KEY": "{file:~/.secrets/yt-api-key}",
      "YOUTUBE_ACCESS_TOKEN": "{file:~/.secrets/yt-access-token}"
    }
  }
}
```

Replace `<path-to-repo>` with the absolute path where you cloned it, or install
it via npm to run it by name:

```sh
npm install -g .
# then use:  "command": ["yt-playlist-organizer-mcp"]
```

To run it through the Nix shell instead, use the same key but change `command`:

```jsonc
"command": ["nix", "develop", "<path-to-repo>", "--command", "node", "dist/index.js"],
```

## Notes

- Quota costs are per the official API docs and documented per tool.
- `part` values are validated against the valid sets for each resource.
- `playlists_list` / `playlistItems_list` require exactly one filter parameter;
  otherwise input validation rejects the call.
- Update tools (`playlists_update`, `playlistItems_update`) read the existing
  resource first and preserve any omitted fields (e.g. `description`,
  `privacyStatus`, `position`, `contentDetails`), rather than clearing them.
  Each update therefore costs an extra read against your quota.
- `startAt`/`endAt` are provided in **seconds** and converted to ISO 8601
  durations (`PT1M30S`) before being sent to the API.
- This server **cannot handle the default "Watch Later" playlist** (`WL`). It
  is a constant (not a real playlist ID) in the public YouTube API, and there is
  no supported way to modify it via the API. See
  [Stack Overflow](https://stackoverflow.com/a/39555756) for details.

## Development

```sh
npm install
npm test         # vitest unit tests
npm run typecheck
npm run build
```

## License

MIT