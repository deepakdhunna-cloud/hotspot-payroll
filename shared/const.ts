export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/**
 * PIN sessions last 7 days, then the manager signs in again.
 * Rotating a PIN immediately invalidates every session issued before the
 * rotation (see server/_core/pinAuth.ts), so a lost device can be cut off.
 */
export const PIN_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'PIN required (10001)';
export const PIN_COOKIE_NAME = 'hotspot_pin_session';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
