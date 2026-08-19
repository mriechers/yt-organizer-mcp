import { z } from "zod";
import type { YouTubeClient, ToolDefinition } from "./types.js";
import {
  parseParts,
  onBehalfParams,
  onBehalfOfFieldsShape,
  type OnBehalfArgs,
} from "./util.js";

// Valid `part` names for playlist resources.
const PLAYLIST_PARTS = [
  "id",
  "snippet",
  "status",
  "contentDetails",
  "player",
  "localizations",
];

const privacyStatusSchema = z.enum(["private", "public", "unlisted"]);

const onBehalfOf = onBehalfOfFieldsShape;

// --- Playlists:list ---------------------------------------------------------

const playsSchema = z.object({
  part: z
    .string()
    .default("snippet,contentDetails,status")
    .describe(
      "Comma-separated playlist resource properties to include. Options: contentDetails, id, localizations, player, snippet, status.",
    ),
  channelId: z
    .string()
    .optional()
    .describe("Return only the specified channel's playlists."),
  id: z
    .string()
    .optional()
    .describe("Comma-separated list of playlist IDs to retrieve."),
  mine: z
    .boolean()
    .optional()
    .describe(
      "Return only playlists owned by the authenticated user. Requires OAuth access token.",
    ),
  hl: z
    .string()
    .optional()
    .describe("Language code for localized resource metadata (e.g. 'en')."),
  maxResults: z
    .number()
    .int()
    .min(0)
    .max(50)
    .optional()
    .describe("Maximum items to return, 0-50. Default 5."),
  pageToken: z
    .string()
    .optional()
    .describe("Token identifying a specific page in the result set."),
  ...onBehalfOf,
})
  .refine(
    (o) => o.id !== undefined || o.channelId !== undefined || o.mine === true,
    "Specify exactly one filter: id, channelId, or mine=true.",
  );

type PlaysArgs = z.infer<typeof playsSchema>;

async function playlistsList(
  client: YouTubeClient,
  args: PlaysArgs & OnBehalfArgs,
): Promise<unknown> {
  const part = parseParts(
    args.part ?? "snippet,contentDetails,status",
    PLAYLIST_PARTS,
  );
  const res = await client.request<{ items?: unknown[] }>({
    method: "GET",
    path: "/playlists",
    params: {
      part,
      channelId: args.channelId,
      id: args.id,
      mine: args.mine === true ? "true" : undefined,
      hl: args.hl,
      maxResults: args.maxResults,
      pageToken: args.pageToken,
      ...onBehalfParams(args),
    },
  });
  return res.items === undefined ? { ...res, items: [] } : res;
}

// --- Playlists:insert -------------------------------------------------------

const playlistInsertSchema = z.object({
  title: z.string().min(1).describe("Playlist title. Required."),
  description: z.string().optional().describe("Playlist description."),
  privacyStatus: privacyStatusSchema
    .default("private")
    .describe("Playlist privacy status. Allowed: private, public, unlisted."),
  defaultLanguage: z
    .string()
    .optional()
    .describe("Default language for the playlist's snippet (e.g. 'en')."),
  part: z
    .string()
    .default("snippet,status")
    .describe(
      "Resource properties to set and return. Options: contentDetails, id, localizations, player, snippet, status.",
    ),
  onBehalfOfContentOwner: onBehalfOf.onBehalfOfContentOwner,
  onBehalfOfContentOwnerChannel: onBehalfOf.onBehalfOfContentOwnerChannel,
});

type PlaylistInsertArgs = z.infer<typeof playlistInsertSchema>;

async function playlistInsert(
  client: YouTubeClient,
  args: PlaylistInsertArgs,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    kind: "youtube#playlist",
    snippet: { title: args.title },
    status: { privacyStatus: args.privacyStatus },
  };
  const snippet = body.snippet as Record<string, unknown>;
  if (args.description !== undefined) snippet.description = args.description;
  if (args.defaultLanguage !== undefined) {
    snippet.defaultLanguage = args.defaultLanguage;
  }

  const part = parseParts(args.part, PLAYLIST_PARTS);
  return client.request({
    method: "POST",
    path: "/playlists",
    params: { part, ...onBehalfParams(args) },
    body,
  });
}

// --- Playlists:update -------------------------------------------------------

const playlistUpdateSchema = z.object({
  id: z.string().min(1).describe("YouTube playlist ID to update. Required."),
  title: z
    .string()
    .min(1)
    .describe(
      "New playlist title. Required (this method overrides the snippet).",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "New description. If omitted the existing description is preserved (the current value is fetched and re-sent).",
    ),
  privacyStatus: privacyStatusSchema
    .optional()
    .describe(
      "New playlist privacy status. If omitted the existing value is preserved. Allowed: private, public, unlisted.",
    ),
  part: z
    .string()
    .default("snippet,status")
    .describe(
      "Resource properties to override and return. Must include 'snippet'.",
    ),
  onBehalfOfContentOwner: onBehalfOf.onBehalfOfContentOwner,
  onBehalfOfContentOwnerChannel: onBehalfOf.onBehalfOfContentOwnerChannel,
});

type PlaylistUpdateArgs = z.infer<typeof playlistUpdateSchema>;

async function playlistUpdate(
  client: YouTubeClient,
  args: PlaylistUpdateArgs,
): Promise<unknown> {
  let part = parseParts(args.part, PLAYLIST_PARTS);
  if (!part.split(",").includes("snippet")) {
    throw new Error("playlists update requires the 'snippet' part.");
  }

  // Read-then-write: fetch the current snippet and status so that omitted
  // fields (description, privacyStatus) are preserved rather than cleared,
  // per the YouTube API's "omitted snippet fields are cleared" semantics.
  const needFetch = args.description === undefined || args.privacyStatus === undefined;
  const fetched = needFetch
    ? await client.request<{
        snippet?: { description?: string };
        status?: { privacyStatus?: string };
      }>({
        method: "GET",
        path: "/playlists",
        params: { part: "snippet,status", id: args.id, ...onBehalfParams(args) },
      })
    : undefined;

  const description = args.description ?? fetched?.snippet?.description;
  const privacyStatus = args.privacyStatus ?? fetched?.status?.privacyStatus;

  const body: Record<string, unknown> = {
    kind: "youtube#playlist",
    id: args.id,
    snippet: { title: args.title },
  };
  const snippet = body.snippet as Record<string, unknown>;
  if (description !== undefined) snippet.description = description;
  if (privacyStatus !== undefined) {
    body.status = { privacyStatus };
  }

  return client.request({
    method: "PUT",
    path: "/playlists",
    params: { part, ...onBehalfParams(args) },
    body,
  });
}

// --- Playlists:delete -------------------------------------------------------

const playlistDeleteSchema = z.object({
  id: z.string().min(1).describe("YouTube playlist ID to delete. Required."),
  onBehalfOfContentOwner: onBehalfOf.onBehalfOfContentOwner,
});

type PlaylistDeleteArgs = z.infer<typeof playlistDeleteSchema>;

async function playlistDelete(
  client: YouTubeClient,
  args: PlaylistDeleteArgs,
): Promise<unknown> {
  await client.request({
    method: "DELETE",
    path: "/playlists",
    params: { id: args.id, ...onBehalfParams(args) },
  });
  return { success: true, message: `Playlist ${args.id} deleted.` };
}

// --- Registration -----------------------------------------------------------

export const playlistTools: ToolDefinition[] = [
  {
    name: "playlists_list",
    description:
      "Get YouTube playlists. Requires exactly one filter: id, channelId, or mine=true (mine=true requires an OAuth access token, not an API key). Quota cost: 1 unit.",
    schema: playsSchema,
    handler: playlistsList,
  },
  {
    name: "playlists_insert",
    description:
      "Create a YouTube playlist (requires title). Quota cost: 50 units. Requires OAuth access token.",
    schema: playlistInsertSchema,
    handler: playlistInsert,
  },
  {
    name: "playlists_update",
    description:
      "Modify a YouTube playlist (id and title required; overrides snippet). If description or privacyStatus are omitted their current values are preserved. Quota cost: 50 units. Requires OAuth access token.",
    schema: playlistUpdateSchema,
    handler: playlistUpdate,
  },
  {
    name: "playlists_delete",
    description:
      "Delete a YouTube playlist. Quota cost: 50 units. Requires OAuth access token.",
    schema: playlistDeleteSchema,
    handler: playlistDelete,
  },
];