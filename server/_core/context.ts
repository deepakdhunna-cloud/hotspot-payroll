import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifyPinSession, type PinSession } from "./pinAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  session: PinSession | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let session: PinSession | null = null;
  try {
    session = await verifyPinSession(opts.req);
  } catch {
    session = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    session,
  };
}
