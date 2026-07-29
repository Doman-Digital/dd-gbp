/**
 * Google user OAuth (refresh-token) auth -- for APIs that reject service
 * accounts, notably the Business Profile API (all scopes) and Search Console
 * on domain-verified properties.
 *
 * This code is identity-agnostic: which actual Google Cloud OAuth client it
 * talks to (the agency's shared client, or a business's own dedicated client)
 * is entirely a function of which GBP_CLIENT_ID / GBP_CLIENT_SECRET /
 * GBP_REFRESH_TOKEN values are set in the deploying app's environment -- not
 * a code-level distinction. Each app/deployment configures its own.
 *
 * Env: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN.
 */

interface CachedToken {
  accessToken: string;
  /** epoch ms when the token should be considered expired */
  expiresAt: number;
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const EXPIRY_SKEW_MS = 60 * 1000; // refresh a minute early

let cached: CachedToken | null = null;

/** True when the OAuth client + refresh token are present. */
export function hasGoogleOAuthCredentials(): boolean {
  return Boolean(
    process.env.GBP_CLIENT_ID && process.env.GBP_CLIENT_SECRET && process.env.GBP_REFRESH_TOKEN,
  );
}

/**
 * Exchange the stored refresh token for a short-lived access token. Returns
 * `null` when credentials aren't configured so callers can degrade
 * gracefully. The token's actual scopes are whatever the refresh token was
 * granted with -- not scoped per call.
 */
export async function getGoogleOAuthAccessToken(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  if (!hasGoogleOAuthCredentials()) return null;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GBP_CLIENT_ID!,
      client_secret: process.env.GBP_CLIENT_SECRET!,
      refresh_token: process.env.GBP_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
  };

  return cached.accessToken;
}

/** Test-only: clear the module-level token cache between test cases. */
export function _resetTokenCacheForTests(): void {
  cached = null;
}
