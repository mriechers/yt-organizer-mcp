import { z } from "zod";
import type { YouTubeClient, ToolDefinition } from "./types.js";
import {
  parseParts,
  onBehalfParams,
  onBehalfOfFieldsShape,
  toISODuration,
} from "./util.js";

// Valid `part` names for playlistItem resources.
const PLAYLIST_ITEM_PARTS = ["id", "snippet", "contentDetails", "status"];

const onBehalfOf = onBehalfOfFieldsShape;

// --- PlaylistItems:list -----------------------------------------------------

const playlistItemsListSchema = z.object({
  part: z
    .string()
    .default("snippet,contentDetails,status")
    .describe(
      "Comma-separated playlistItem resource properties to include. Options: contentDetails, id, snippet, status.",
    ),
  playlistId: z
    .string()
    .optional()
    .describe("The ID of the playlist whose items to retrieve."),
  id: z
    .string()
    .optional()
    .describe("Comma-separated list of playlist item IDs to retrieve."),
  videoId: z
    .string()
    .optional()
    .describe("Return only playlist items that contain the specified video."),
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
    (o) => o.playlistId !== undefined || o.id !== undefined,
    "Specify exactly one filter: playlistId or id.",
  );

type PlaylistItemsListArgs = z.infer<typeof playlistItemsListSchema>;

async function playlistItemsList(
  client: YouTubeClient,
  args: PlaylistItemsListArgs,
): Promise<unknown> {
  const part = parseParts(
    args.part ?? "snippet,contentDetails,status",
    PLAYLIST_ITEM_PARTS,
  );
  const res = await client.request<{ items?: unknown[] }>({
    method: "GET",
    path: "/playlistItems",
    params: {
      part,
      playlistId: args.playlistId,
      id: args.id,
      videoId: args.videoId,
      maxResults: args.maxResults,
      pageToken: args.pageToken,
      ...onBehalfParams(args),
    },
  });
  return res.items === undefined ? { ...res, items: [] } : res;
}

// --- contentDetails builder -------------------------------------------------

function buildContentDetails(args: {
  startAt?: number;
  endAt?: number;
  note?: string;
}): Record<string, unknown> | undefined {
  if (args.startAt === undefined && args.endAt === undefined && args.note === undefined) {
    return undefined;
  }
  const cd: Record<string, unknown> = {};
  if (args.startAt !== undefined) cd.startAt = toISODuration(args.startAt);
  if (args.endAt !== undefined) cd.endAt = toISODuration(args.endAt);
  if (args.note !== undefined) cd.note = args.note;
  return cd;
}

const contentDetailsFields = {
  startAt: z
    .number()
    .int()
    .optional()
    .describe("Start time in seconds of the video portion to play (contentDetails)."),
  endAt: z
    .number()
    .int()
    .optional()
    .describe("End time in seconds of the video portion to play (contentDetails)."),
  note: z
    .string()
    .max(280)
    .optional()
    .describe("Maximum 280 characters. Note associated with the playlist item."),
} as const;

// --- PlaylistItems:insert ---------------------------------------------------

const playlistItemsInsertSchema = z.object({
  playlistId: z.string().min(1).describe("The ID of the playlist to add the item to. Required."),
  videoId: z.string().min(1).describe("The YouTube video ID to add to the playlist. Required."),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("The 0-based position of the item. Only if the playlist uses manual ordering."),
  ...contentDetailsFields,
  part: z
    .string()
    .default("snippet")
    .describe("Resource properties to set and return. Options: contentDetails, id, snippet, status."),
  ...onBehalfOf,
});

type PlaylistItemsInsertArgs = z.infer<typeof playlistItemsInsertSchema>;

async function playlistItemsInsert(
  client: YouTubeClient,
  args: PlaylistItemsInsertArgs,
): Promise<unknown> {
  const snippet: Record<string, unknown> = {
    playlistId: args.playlistId,
    resourceId: { kind: "youtube#video", videoId: args.videoId },
  };
  if (args.position !== undefined) snippet.position = args.position;

  const body: Record<string, unknown> = {
    kind: "youtube#playlistItem",
    snippet,
  };
  const contentDetails = buildContentDetails(args);
  let hasContentDetails = contentDetails !== undefined;
  if (contentDetails) body.contentDetails = contentDetails;

  const part = parseParts(args.part, PLAYLIST_ITEM_PARTS);
  const parsed = hasContentDetails
    ? parseParts(`${part},contentDetails`, PLAYLIST_ITEM_PARTS)
    : part;

  return client.request({
    method: "POST",
    path: "/playlistItems",
    params: { part: parsed, ...onBehalfParams(args) },
    body,
  });
}

// --- PlaylistItems:update ---------------------------------------------------

const playlistItemsUpdateSchema = z.object({
  id: z.string().min(1).describe("The playlist item ID to update. Required."),
  playlistId: z.string().min(1).describe("The ID of the playlist containing the item. Required."),
  videoId: z.string().min(1).describe("The video ID of the item. Required."),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("The new 0-based position of the item. Only if the playlist uses manual ordering."),
  ...contentDetailsFields,
  part: z
    .string()
    .default("snippet,contentDetails")
    .describe("Resource properties to override and return. Must include 'snippet'."),
  ...onBehalfOf,
});

type PlaylistItemsUpdateArgs = z.infer<typeof playlistItemsUpdateSchema>;

async function playlistItemsUpdate(
  client: YouTubeClient,
  args: PlaylistItemsUpdateArgs,
): Promise<unknown> {
  let part = parseParts(args.part, PLAYLIST_ITEM_PARTS);
  if (!part.split(",").includes("snippet")) {
    throw new Error("playlistItems update requires the 'snippet' part.");
  }

  // Read-then-write: fetch the current item so omitted snippet/contentDetails
  // fields are preserved rather than cleared, per the API's update semantics.
  const needFetch =
    args.position === undefined ||
    args.startAt === undefined ||
    args.endAt === undefined ||
    args.note === undefined;
  const fetched = needFetch
    ? await client.request<{
        snippet?: {
          position?: number;
          description?: string;
          title?: string;
          channelId?: string;
        };
        contentDetails?: { startAt?: string; endAt?: string; note?: string };
      }>({
        method: "GET",
        path: "/playlistItems",
        params: { part: "snippet,contentDetails,status", id: args.id, ...onBehalfParams(args) },
      })
    : undefined;

  const position = args.position ?? fetched?.snippet?.position;
  const snippet: Record<string, unknown> = {
    playlistId: args.playlistId,
    resourceId: { kind: "youtube#video", videoId: args.videoId },
  };
  if (position !== undefined) snippet.position = position;
  // Preserve any other snippet fields the API tracks that we don't model (e.g.
  // description, title) so an update positions an item without dropping the
  // rest of the snippet.
  if (fetched?.snippet) {
    for (const key of ["title", "description", "channelId"] as const) {
      const val = fetched.snippet[key];
      if (val !== undefined) snippet[key] = val;
    }
  }

  const body: Record<string, unknown> = {
    kind: "youtube#playlistItem",
    id: args.id,
    snippet,
  };
  const contentDetails = buildContentDetails(args);
  let hasContentDetails = contentDetails !== undefined;
  if (contentDetails) body.contentDetails = contentDetails;
  // Preserve existing contentDetails fields not being updated.
  else if (fetched?.contentDetails) {
    body.contentDetails = {};
    const cd = body.contentDetails as Record<string, unknown>;
    if (args.startAt === undefined && fetched.contentDetails.startAt !== undefined) {
      cd.startAt = fetched.contentDetails.startAt;
    }
    if (args.endAt === undefined && fetched.contentDetails.endAt !== undefined) {
      cd.endAt = fetched.contentDetails.endAt;
    }
    if (args.note === undefined && fetched.contentDetails.note !== undefined) {
      cd.note = fetched.contentDetails.note;
    }
    hasContentDetails = Object.keys(cd).length > 0;
    if (!hasContentDetails) delete body.contentDetails;
  }

  const partsArray = part.split(",");
  if (hasContentDetails && !partsArray.includes("contentDetails")) {
    partsArray.push("contentDetails");
  }
  const parsed = parseParts(partsArray.join(","), PLAYLIST_ITEM_PARTS);

  return client.request({
    method: "PUT",
    path: "/playlistItems",
    params: { part: parsed, ...onBehalfParams(args) },
    body,
  });
}

// --- PlaylistItems:delete ---------------------------------------------------

const playlistItemsDeleteSchema = z.object({
  id: z.string().min(1).describe("The playlist item ID to delete. Required."),
  ...onBehalfOf,
});

type PlaylistItemsDeleteArgs = z.infer<typeof playlistItemsDeleteSchema>;

async function playlistItemsDelete(
  client: YouTubeClient,
  args: PlaylistItemsDeleteArgs,
): Promise<unknown> {
  await client.request({
    method: "DELETE",
    path: "/playlistItems",
    params: { id: args.id, ...onBehalfParams(args) },
  });
  return { success: true, message: `Playlist item ${args.id} deleted.` };
}

// --- Registration -----------------------------------------------------------

export const playlistItemTools: ToolDefinition[] = [
  {
    name: "playlistItems_list",
    description:
      "Get items in a YouTube playlist. Requires exactly one filter: playlistId or id. If both are omitted the call is rejected. Quota cost: 1 unit.",
    schema: playlistItemsListSchema,
    handler: playlistItemsList,
  },
  {
    name: "playlistItems_insert",
    description:
      "Add a video (videoId) to a playlist (playlistId). startAt/endAt are in seconds and converted to ISO 8601 durations. Quota cost: 50 units. Requires OAuth access token.",
    schema: playlistItemsInsertSchema,
    handler: playlistItemsInsert,
  },
  {
    name: "playlistItems_update",
    description:
      "Modify a playlist item (e.g. its position). Omitted snippet/contentDetails fields are preserved. Quota cost: 50 units. Requires OAuth access token.",
    schema: playlistItemsUpdateSchema,
    handler: playlistItemsUpdate,
  },
  {
    name: "playlistItems_delete",
    description:
      "Remove a playlist item from a playlist. Quota cost: 50 units. Requires OAuth access token.",
    schema: playlistItemsDeleteSchema,
    handler: playlistItemsDelete,
  },
];