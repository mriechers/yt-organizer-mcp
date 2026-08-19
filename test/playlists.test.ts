import { describe, it, expect } from "vitest";
import { playlistTools } from "../src/playlists.js";

const listTool = playlistTools.find((t) => t.name === "playlists_list")!;
const updateTool = playlistTools.find((t) => t.name === "playlists_update")!;

describe("playlists_list schema validation", () => {
  it("requires exactly one filter", () => {
    const parsed = listTool.schema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("accepts a single filter", () => {
    const parsed = listTool.schema.safeParse({ channelId: "UC123" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.channelId).toBe("UC123");
    }
  });

  it("applies the part default", () => {
    const parsed = listTool.schema.safeParse({ id: "PL1" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.part).toBe("snippet,contentDetails,status");
    }
  });
});

describe("playlists_update schema", () => {
  it("no longer defaults privacyStatus (so it can be preserved)", () => {
    const parsed = updateTool.schema.safeParse({
      id: "PL1",
      title: "New title",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.privacyStatus).toBeUndefined();
      expect(parsed.data.description).toBeUndefined();
      expect(parsed.data.title).toBe("New title");
    }
  });

  it("supplies a default part", () => {
    const parsed = updateTool.schema.safeParse({ id: "PL1", title: "t" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.part).toBe("snippet,status");
  });
});