import { describe, expect, it } from "vitest";
import {
  NAV_FULL_DEFAULT,
  NAV_FULL_MAX,
  NAV_FULL_MIN,
  NAV_RAIL,
  maxFullWidth,
  resolveNavWidth,
} from "@/lib/navSize";

/**
 * The side navigation's width: the person's choice, trimmed so the page
 * beside it always keeps room to work in.
 */
describe("side navigation width", () => {
  it("phones have no side navigation at all", () => {
    expect(resolveNavWidth(393, null)).toBe(0);
    expect(resolveNavWidth(626, 300)).toBe(0); // a foldable held upright
    expect(resolveNavWidth(767, "rail")).toBe(0);
  });

  it("with no choice made: the rail, then the full sidebar from 1360px", () => {
    expect(resolveNavWidth(768, null)).toBe(NAV_RAIL);
    expect(resolveNavWidth(890, null)).toBe(NAV_RAIL); // a foldable held sideways
    expect(resolveNavWidth(1359, null)).toBe(NAV_RAIL);
    expect(resolveNavWidth(1360, null)).toBe(NAV_FULL_DEFAULT);
    expect(resolveNavWidth(1920, null)).toBe(NAV_FULL_DEFAULT);
  });

  it("a chosen rail stays a rail on any window", () => {
    expect(resolveNavWidth(1920, "rail")).toBe(NAV_RAIL);
  });

  it("a chosen width is honoured where the page still has 640px", () => {
    // A foldable held sideways (890px) can open the full sidebar: 890 - 640 = 250.
    expect(maxFullWidth(890)).toBe(250);
    expect(resolveNavWidth(890, 240)).toBe(240);
    expect(resolveNavWidth(890, 320)).toBe(250); // trimmed, never refused
    expect(resolveNavWidth(1440, 320)).toBe(320);
    expect(resolveNavWidth(1440, NAV_FULL_MAX)).toBe(NAV_FULL_MAX);
  });

  it("where the full sidebar cannot fit, a chosen width falls back to the rail", () => {
    // A small tablet held upright: 768 - 640 = 128, less than the narrowest sidebar.
    expect(maxFullWidth(768)).toBe(0);
    expect(resolveNavWidth(768, 240)).toBe(NAV_RAIL);
    expect(maxFullWidth(839)).toBe(0);
    expect(maxFullWidth(840)).toBe(NAV_FULL_MIN);
  });
});
