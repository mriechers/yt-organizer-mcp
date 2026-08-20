#!/usr/bin/env node
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { YouTubeClient, YouTubeApiError, REQUIRED_SCOPES } from "./youtube.js";
import { playlistTools } from "./playlists.js";
import { playlistItemTools } from "./playlistItems.js";
import type { ToolDefinition } from "./types.js";

interface Env {
  YOUTUBE_API_KEY?: string;
  YOUTUBE_ACCESS_TOKEN?: string;
}

function loadConfig(): Env {
  return {
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    YOUTUBE_ACCESS_TOKEN: process.env.YOUTUBE_ACCESS_TOKEN,
  };
}

/** Wrap a handler + shared error funnel in a single place. */
function registerTool(server: McpServer, tool: ToolDefinition, client: YouTubeClient) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args) => {
      try {
        const result = await tool.handler(client, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        if (err instanceof YouTubeApiError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: err.message,
                    status: err.status,
                    reason: err.reason,
                    detail: err.detail,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        // Non-API errors become a normal (error-tagged) response too, so the
        // model sees a structured message instead of a transport failure.
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}

async function main() {
  const env = loadConfig();

  const server = new McpServer(
    {
      name: "yt-playlist-organizer-mcp",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  const client = new YouTubeClient({
    apiKey: env.YOUTUBE_API_KEY,
    accessToken: env.YOUTUBE_ACCESS_TOKEN,
  });

  const allTools = [...playlistTools, ...playlistItemTools];
  for (const tool of allTools) {
    registerTool(server, tool, client);
  }

  // Server-level basic info tool.
  server.registerTool(
    "auth_status",
    {
      description:
        "Check whether API key and/or OAuth access token are configured. Note: this server cannot handle the default \"Watch Later\" playlist (WL) because it is a constant (not a real playlist ID) in the public YouTube API and cannot be modified via the API; see https://stackoverflow.com/a/39555756 .",
      inputSchema: z.object({}),
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                apiKeyConfigured: Boolean(env.YOUTUBE_API_KEY),
                accessTokenConfigured: Boolean(env.YOUTUBE_ACCESS_TOKEN),
                canWrite: Boolean(env.YOUTUBE_ACCESS_TOKEN),
                requiredScopes: REQUIRED_SCOPES,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error starting yt-data-api-mcp:", err);
  process.exit(1);
});