import type { z } from "zod";
import type { YouTubeClient } from "./youtube.js";

export type { YouTubeClient };

/**
 * The value a tool handler returns (an arbitrary API result). The registration
 * wrapper serializes it into an MCP text response.
 */
export type ToolResult = unknown;

/**
 * A registered tool definition.
 *
 * `handler.args` is deliberately `any`: the SDK already validated the
 * arguments against `schema` before invoking the handler (defaults applied,
 * refinements enforced), so the handler receives a value matching the schema's
 * output. Each concrete handler redeclares its own typed arg signature.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (
    client: YouTubeClient,
    args: any,
  ) => Promise<unknown>;
}