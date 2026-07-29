import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetTokenCacheForTests,
  getGoogleOAuthAccessToken,
  hasGoogleOAuthCredentials,
} from "../oauth-client";

const ENV_KEYS = ["GBP_CLIENT_ID", "GBP_CLIENT_SECRET", "GBP_REFRESH_TOKEN"] as const;

function setCreds() {
  process.env.GBP_CLIENT_ID = "client-id";
  process.env.GBP_CLIENT_SECRET = "client-secret";
  process.env.GBP_REFRESH_TOKEN = "refresh-token";
}

beforeEach(() => {
  _resetTokenCacheForTests();
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("hasGoogleOAuthCredentials", () => {
  it("is false when any of the three env vars is missing", () => {
    process.env.GBP_CLIENT_ID = "client-id";
    expect(hasGoogleOAuthCredentials()).toBe(false);
  });

  it("is true when all three are set", () => {
    setCreds();
    expect(hasGoogleOAuthCredentials()).toBe(true);
  });
});

describe("getGoogleOAuthAccessToken", () => {
  it("returns null without fetching when credentials are missing", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const token = await getGoogleOAuthAccessToken();

    expect(token).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exchanges the refresh token for an access token", async () => {
    setCreds();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "token-abc", expires_in: 3600 }),
    } as Response);

    const token = await getGoogleOAuthAccessToken();

    expect(token).toBe("token-abc");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("caches the token and does not re-fetch on the next call", async () => {
    setCreds();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "token-abc", expires_in: 3600 }),
    } as Response);

    await getGoogleOAuthAccessToken();
    const second = await getGoogleOAuthAccessToken();

    expect(second).toBe("token-abc");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when the token endpoint responds with a non-OK status", async () => {
    setCreds();
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid_grant",
    } as Response);

    await expect(getGoogleOAuthAccessToken()).rejects.toThrow(/Google OAuth token refresh failed: 401/);
  });
});
