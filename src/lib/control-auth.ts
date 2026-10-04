/**
 * Authentication for the endpoint a scheduler calls to run the control loops.
 *
 * The caller sends `Authorization: Bearer <secret>` and the server compares it with
 * CONTROL_CRON_SECRET. Both sides are hashed first so the comparison is constant time whatever the
 * lengths. With no secret configured the endpoint refuses everything (500) rather than being open.
 * Server only: it uses node:crypto.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Null when the request may proceed, otherwise the response to send back. */
export function authenticateControlRequest(
  authorization: string | null,
  secret: string | undefined,
): Response | null {
  if (!secret || secret.length < 16) {
    return new Response(
      "Control endpoint is not configured: set CONTROL_CRON_SECRET (16+ characters)",
      {
        status: 500,
      },
    );
  }
  const match = /^Bearer ([^\s,]+)$/.exec(authorization ?? "");
  if (!match?.[1]) return new Response("Unauthorized", { status: 401 });
  if (!timingSafeEqual(digest(match[1]), digest(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
