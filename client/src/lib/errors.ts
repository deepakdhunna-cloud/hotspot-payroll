/**
 * Turn any thrown error (tRPC, zod, network) into one plain sentence for a
 * toast or an inline message. Input-validation failures arrive from the
 * server as a JSON list of issues; people should never see that JSON.
 */
export function errorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = (err as { message?: unknown } | null)?.message;
  const msg = typeof raw === "string" ? raw.trim() : "";
  if (!msg) return fallback;
  if (msg.startsWith("[") || msg.startsWith("{")) {
    try {
      const parsed = JSON.parse(msg) as
        | Array<{ message?: string }>
        | { message?: string };
      const issues = Array.isArray(parsed) ? parsed : [parsed];
      const first = issues.find((i) => typeof i?.message === "string");
      if (first?.message) return plainIssue(first.message);
    } catch {
      /* not JSON — fall through */
    }
    return fallback;
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Can't reach the server. Check the connection and try again.";
  }
  return msg;
}

/** Soften zod's stock wording ("Number must be less than or equal to 168"). */
function plainIssue(message: string): string {
  const max = message.match(/less than or equal to ([\d.]+)/i);
  if (max) return `That number is too high — the most allowed is ${max[1]}.`;
  const min = message.match(/greater than or equal to ([\d.]+)/i);
  if (min) return `That number is too low — the least allowed is ${min[1]}.`;
  if (/^required$/i.test(message)) return "Please fill in every required field.";
  return message;
}
