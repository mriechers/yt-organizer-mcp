import { z } from "zod";

/** Validates a comma-separated `part` string against an allowed set. */
export function parseParts(input: string, allowed: string[]): string {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const invalid = parts.filter((p) => !allowed.includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid part(s): ${invalid.join(", ")}. Allowed: ${allowed.join(", ")}`,
    );
  }
  if (parts.length === 0) throw new Error("At least one part is required.");
  return parts.join(",");
}

/** Converts a count of seconds into an ISO 8601 duration (PT1M30S) for the YouTube API. */
export function toISODuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new Error(`Invalid duration in seconds: ${totalSeconds}`);
  }
  const s = Math.trunc(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  let out = "PT";
  if (hours > 0) out += `${hours}H`;
  if (minutes > 0) out += `${minutes}M`;
  if (seconds > 0 || s === 0) out += `${seconds}S`;
  return out;
}

/** The YouTube-partners-only fields, shared across all tool schemas. */
export const onBehalfOfFieldsShape = {
  onBehalfOfContentOwner: z
    .string()
    .optional()
    .describe("Content owner to act on behalf of (YouTube partners only)."),
  onBehalfOfContentOwnerChannel: z
    .string()
    .optional()
    .describe("Channel ID to act on behalf of (YouTube partners only)."),
} as const;

export type OnBehalfArgs = {
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
};

/** Extracts the non-empty partner fields into a request params object. */
export function onBehalfParams(
  args: OnBehalfArgs,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (args.onBehalfOfContentOwner) {
    params.onBehalfOfContentOwner = args.onBehalfOfContentOwner;
  }
  if (args.onBehalfOfContentOwnerChannel) {
    params.onBehalfOfContentOwnerChannel = args.onBehalfOfContentOwnerChannel;
  }
  return params;
}