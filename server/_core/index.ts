import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ensureDefaultPins } from "./pinAuth";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // Ensure the default Hotspot PINs exist (CEO + 4 store PINs).
  ensureDefaultPins().catch((err) => console.error("[PinAuth] init failed:", err));
  // CSRF guard: session cookies are SameSite=None (the platform preview runs
  // the app inside an iframe), so cross-site POSTs would otherwise carry them.
  // Mutating API requests must come from our own origin (or a non-browser
  // client that sends no Origin header at all).
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
      const host = new URL(origin).host;
      const expected = req.headers["x-forwarded-host"] ?? req.headers.host;
      const expectedHosts = (Array.isArray(expected) ? expected : [expected ?? ""])
        .flatMap((h) => h.split(","))
        .map((h) => h.trim())
        .filter(Boolean);
      if (expectedHosts.includes(host)) return next();
    } catch {
      // Malformed Origin header — treat as cross-site.
    }
    res.status(403).json({ error: "Cross-origin request rejected" });
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
