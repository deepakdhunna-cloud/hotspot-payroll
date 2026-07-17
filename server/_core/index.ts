import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { csrfOriginGuard } from "../csrf";
import { runBootstrap } from "../bootstrap";
import { sweepAutoClockOut } from "../autoClockOut";
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
  // Security headers on every response. Deliberately conservative: nothing
  // here changes how the app works — it only tells browsers to stop sniffing
  // content types, keep referrers tight, insist on HTTPS, and deny unused
  // powerful APIs. (No frame-ancestors/CSP frame rules: embedding stays
  // possible by design.)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    next();
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // Apply migrations (idempotent) and, when configured, the one-time data
  // import — must finish before the app serves queries.
  await runBootstrap();
  // Ensure the default Hotspot PINs exist (CEO + 4 store PINs).
  ensureDefaultPins().catch((err) => console.error("[PinAuth] init failed:", err));
  // Auto clock-out sweep: runs at boot and every 5 minutes so forgotten
  // clock-outs are closed at the owner's limit even when nobody has the
  // site open. (No-op until the CEO sets a limit in Payroll → Punches.)
  const runSweep = () =>
    sweepAutoClockOut()
      .then((n) => {
        if (n > 0) console.log(`[AutoClockOut] closed ${n} over-limit punch(es)`);
      })
      .catch((err) => console.error("[AutoClockOut] sweep failed:", err));
  runSweep();
  setInterval(runSweep, 5 * 60_000);
  // CSRF guard for mutating API requests (see server/csrf.ts + its tests).
  app.use("/api", csrfOriginGuard);
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
