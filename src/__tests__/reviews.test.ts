import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTokenCacheForTests } from "../oauth-client";
import { getBusinessReviews, isBusinessProfileConfigured } from "../reviews";

const ENV_KEYS = [
  "GBP_CLIENT_ID",
  "GBP_CLIENT_SECRET",
  "GBP_REFRESH_TOKEN",
  "GOOGLE_BUSINESS_ACCOUNT_ID",
  "GOOGLE_BUSINESS_LOCATION_ID",
] as const;

function setConfigured() {
  process.env.GBP_CLIENT_ID = "client-id";
  process.env.GBP_CLIENT_SECRET = "client-secret";
  process.env.GBP_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_BUSINESS_ACCOUNT_ID = "accounts/123";
  process.env.GOOGLE_BUSINESS_LOCATION_ID = "locations/456";
}

function mockTokenExchange() {
  return { ok: true, json: async () => ({ access_token: "token-abc", expires_in: 3600 }) };
}

beforeEach(() => {
  _resetTokenCacheForTests();
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("isBusinessProfileConfigured", () => {
  it("is false when env vars are missing", () => {
    expect(isBusinessProfileConfigured()).toBe(false);
  });

  it("is true once all five env vars are set", () => {
    setConfigured();
    expect(isBusinessProfileConfigured()).toBe(true);
  });
});

describe("getBusinessReviews", () => {
  it("returns empty results without making any fetch call when unconfigured", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await getBusinessReviews();

    expect(result).toEqual({ averageRating: null, totalReviewCount: 0, reviews: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a review's reply onto BusinessReview.reply, with no author field", async () => {
    setConfigured();
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(mockTokenExchange() as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        averageRating: 5,
        totalReviewCount: 1,
        reviews: [
          {
            reviewId: "r1",
            reviewer: { displayName: "Jane", profilePhotoUrl: "https://example.com/p.jpg" },
            starRating: "FIVE",
            comment: "Great service.",
            createTime: "2026-06-08T00:00:00Z",
            reviewReply: { comment: "Thanks Jane!", updateTime: "2026-06-09T00:00:00Z" },
          },
        ],
      }),
    } as Response);

    const result = await getBusinessReviews();

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toEqual({
      id: "r1",
      author: "Jane",
      authorPhoto: "https://example.com/p.jpg",
      rating: 5,
      comment: "Great service.",
      createdAt: "2026-06-08T00:00:00Z",
      reply: { text: "Thanks Jane!", updatedAt: "2026-06-09T00:00:00Z" },
    });
    expect((result.reviews[0].reply as unknown as Record<string, unknown>).author).toBeUndefined();
  });

  it("omits reply when the review has none", async () => {
    setConfigured();
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(mockTokenExchange() as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        averageRating: 5,
        totalReviewCount: 1,
        reviews: [
          {
            reviewId: "r2",
            reviewer: { displayName: "Sam" },
            starRating: "FIVE",
            comment: "Nice.",
            createTime: "2026-07-01T00:00:00Z",
          },
        ],
      }),
    } as Response);

    const result = await getBusinessReviews();

    expect(result.reviews[0].reply).toBeUndefined();
  });

  it("paginates until nextPageToken is exhausted", async () => {
    setConfigured();
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(mockTokenExchange() as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        averageRating: 5,
        totalReviewCount: 2,
        nextPageToken: "page-2",
        reviews: [
          { reviewId: "r1", reviewer: { displayName: "A" }, starRating: "FIVE", comment: "x", createTime: "t1" },
        ],
      }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        averageRating: 5,
        totalReviewCount: 2,
        reviews: [
          { reviewId: "r2", reviewer: { displayName: "B" }, starRating: "FIVE", comment: "y", createTime: "t2" },
        ],
      }),
    } as Response);

    const result = await getBusinessReviews();

    // getBusinessReviews deliberately shuffles its result, so assert on the
    // set of ids rather than their order. Asserting order here made this test
    // fail roughly half the time, since with two reviews a shuffle returns the
    // input order only 50% of the time.
    expect(result.reviews.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    // token exchange + 2 review pages
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const secondPageUrl = fetchSpy.mock.calls[2][0] as string;
    expect(secondPageUrl).toContain("pageToken=page-2");
  });

  it("filters by minimum star rating for public-facing use", async () => {
    setConfigured();
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(mockTokenExchange() as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        averageRating: 4.5,
        totalReviewCount: 2,
        reviews: [
          { reviewId: "r1", reviewer: { displayName: "A" }, starRating: "FIVE", comment: "x", createTime: "t1" },
          { reviewId: "r2", reviewer: { displayName: "B" }, starRating: "TWO", comment: "y", createTime: "t2" },
        ],
      }),
    } as Response);

    const result = await getBusinessReviews({ filterMinStars: 4 });

    expect(result.reviews.map((r) => r.id)).toEqual(["r1"]);
    // totalReviewCount reflects the location's real total, not the filtered count
    expect(result.totalReviewCount).toBe(2);
  });

  it("throws when the reviews endpoint responds with a non-OK status", async () => {
    setConfigured();
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(mockTokenExchange() as Response);
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" } as Response);

    await expect(getBusinessReviews()).rejects.toThrow(/Business Profile reviews failed: 500/);
  });
});
