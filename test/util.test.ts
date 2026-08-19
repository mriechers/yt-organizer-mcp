import { describe, it, expect } from "vitest";
import { parseParts, toISODuration, onBehalfParams } from "../src/util.js";

describe("parseParts", () => {
  it("splits and trims a comma-separated list", () => {
    expect(parseParts(" snippet , status ", ["snippet", "status"])).toBe(
      "snippet,status",
    );
  });

  it("rejects unknown parts", () => {
    expect(() =>
      parseParts("snippet,bogus", ["snippet", "status"]),
    ).toThrow(/Invalid part/);
  });

  it("rejects an empty part list", () => {
    expect(() => parseParts(" , ", ["snippet"])).toThrow(
      /At least one part/,
    );
  });
});

describe("toISODuration", () => {
  it("converts seconds to ISO 8601", () => {
    expect(toISODuration(90)).toBe("PT1M30S");
    expect(toISODuration(0)).toBe("PT0S");
    expect(toISODuration(60)).toBe("PT1M");
    expect(toISODuration(3600)).toBe("PT1H");
    expect(toISODuration(3661)).toBe("PT1H1M1S");
  });

  it("rejects invalid inputs", () => {
    expect(() => toISODuration(-1)).toThrow(/Invalid duration/);
    expect(() => toISODuration(Number.NaN)).toThrow(/Invalid duration/);
  });
});

describe("onBehalfParams", () => {
  it("only includes defined partner fields", () => {
    expect(onBehalfParams({ onBehalfOfContentOwner: "owner" })).toEqual({
      onBehalfOfContentOwner: "owner",
    });
    expect(onBehalfParams({})).toEqual({});
  });
});