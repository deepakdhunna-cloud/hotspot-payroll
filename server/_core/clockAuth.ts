import { createHash, timingSafeEqual } from "crypto";

/**
 * Hash a raw 4-digit code together with the employee id so the same code
 * used at two different stores still produces a distinct hash.
 * Uses sha256 (no plaintext is ever stored).
 */
export function hashClockCode(rawCode: string, employeeId: number): string {
  const normalized = rawCode.trim();
  if (!/^\d{4}$/.test(normalized)) {
    throw new Error("Clock code must be exactly 4 digits");
  }
  return createHash("sha256")
    .update(`hotspot:clock:${employeeId}:${normalized}`)
    .digest("hex");
}

export function verifyClockCode(
  rawCode: string,
  employeeId: number,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash) return false;
  try {
    const candidate = hashClockCode(rawCode, employeeId);
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
