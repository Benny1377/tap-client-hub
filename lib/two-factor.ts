/**
 * Server-only helpers for email two-factor sign-in.
 *
 * - The emailed code is stored only as a keyed hash, with a count of wrong guesses
 *   ("v1:<hmac>:<attempts>" in profiles.email_2fa_code), so a database read never
 *   reveals a live code and a code allows at most MAX_CODE_ATTEMPTS guesses.
 * - After a correct code the server sets a signed, HttpOnly cookie. The access
 *   resolver requires it for every account with 2FA on, so a password alone never
 *   reaches the app's data.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const TWO_FACTOR_COOKIE = "tap_2fa";
export const TWO_FACTOR_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // seconds
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_RESEND_COOLDOWN_MS = 30 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

function secretKey(purpose: string): Buffer {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("TWO_FACTOR_SECRET or SUPABASE_SERVICE_ROLE_KEY is required for two-factor sign-in");
  return createHash("sha256").update(`tap-hub-2fa-${purpose}-v1:${secret}`).digest();
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A uniformly random six-digit code. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function codeHash(userId: string, code: string): string {
  return createHmac("sha256", secretKey("code")).update(`${userId}:${code}`).digest("hex");
}

/** The stored form of a freshly issued code. */
export function storedCode(userId: string, code: string, attempts = 0): string {
  return `v1:${codeHash(userId, code)}:${attempts}`;
}

export function parseStoredCode(value: unknown): { hash: string; attempts: number } | null {
  const match = /^v1:([0-9a-f]{64}):(\d+)$/.exec(String(value ?? ""));
  return match ? { hash: match[1], attempts: Number(match[2]) } : null;
}

export function codeMatches(userId: string, code: string, hash: string): boolean {
  return /^\d{6}$/.test(code) && sameText(codeHash(userId, code), hash);
}

function cookieSignature(userId: string, expiresAt: number): string {
  return createHmac("sha256", secretKey("cookie")).update(`${userId}|${expiresAt}`).digest("base64url");
}

/** Value for the cookie that proves this browser passed 2FA for this profile. */
export function twoFactorCookieValue(userId: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + TWO_FACTOR_COOKIE_MAX_AGE;
  return `${userId}.${expiresAt}.${cookieSignature(userId, expiresAt)}`;
}

export function twoFactorCookieValid(value: string | undefined, userId: string, now = Date.now()): boolean {
  if (!value) return false;
  const [id, expires, signature, extra] = value.split(".");
  if (extra !== undefined || !id || !expires || !signature || id !== userId) return false;
  const expiresAt = Number(expires);
  if (!Number.isInteger(expiresAt) || expiresAt * 1000 <= now) return false;
  try {
    return sameText(signature, cookieSignature(userId, expiresAt));
  } catch {
    return false;
  }
}

export const twoFactorCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: TWO_FACTOR_COOKIE_MAX_AGE,
};
