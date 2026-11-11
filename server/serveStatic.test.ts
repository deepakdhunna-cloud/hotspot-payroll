import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveStatic } from "./_core/vite";

/**
 * Home-screen app delivery: installed apps must always pick up new deploys
 * (sw.js + manifests revalidate), hashed bundles cache forever, and a
 * bundle that isn't on disk is a 404 — never index.html under a .js URL.
 */
let dir: string;
let base: string;
let close: () => void;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hotspot-static-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    "<!doctype html><title>app</title>"
  );
  fs.writeFileSync(
    path.join(dir, "sw.js"),
    "self.addEventListener('fetch', () => {});"
  );
  fs.writeFileSync(
    path.join(dir, "manifest.webmanifest"),
    JSON.stringify({ name: "Hotspot" })
  );
  fs.writeFileSync(
    path.join(dir, "assets", "index-abc123.js"),
    "console.log(1)"
  );
  const app = express();
  serveStatic(app, dir);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => {
  close?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("serveStatic (home-screen app)", () => {
  it("serves the service worker as JavaScript that always revalidates", async () => {
    const res = await fetch(`${base}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves the manifest with its media type, revalidated on every launch", async () => {
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(
      /application\/manifest\+json/
    );
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("caches hashed bundles forever", async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("answers a missing bundle with 404, not the app shell", async () => {
    const res = await fetch(`${base}/assets/index-gone999.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<!doctype html>");
  });

  it("still falls back to index.html for app routes", async () => {
    const res = await fetch(`${base}/payroll?tab=punches`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>app</title>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
});
