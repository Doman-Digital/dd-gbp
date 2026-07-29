// src/oauth-client.ts
var TOKEN_URI = "https://oauth2.googleapis.com/token";
var EXPIRY_SKEW_MS = 60 * 1e3;
var cached = null;
function hasGoogleOAuthCredentials() {
  return Boolean(
    process.env.GBP_CLIENT_ID && process.env.GBP_CLIENT_SECRET && process.env.GBP_REFRESH_TOKEN
  );
}
async function getGoogleOAuthAccessToken() {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  if (!hasGoogleOAuthCredentials()) return null;
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GBP_CLIENT_ID,
      client_secret: process.env.GBP_CLIENT_SECRET,
      refresh_token: process.env.GBP_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1e3 - EXPIRY_SKEW_MS
  };
  return cached.accessToken;
}

// src/reviews.ts
var STAR_VALUES = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5
};
var MAX_PAGE_SIZE = 50;
var EMPTY = {
  averageRating: null,
  totalReviewCount: 0,
  reviews: []
};
function isBusinessProfileConfigured() {
  return hasGoogleOAuthCredentials() && Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID) && Boolean(process.env.GOOGLE_BUSINESS_LOCATION_ID);
}
function toBusinessReview(r) {
  const review = {
    id: r.reviewId,
    author: r.reviewer?.displayName ?? "Anonymous",
    authorPhoto: r.reviewer?.profilePhotoUrl,
    rating: STAR_VALUES[r.starRating ?? "FIVE"] ?? 5,
    comment: r.comment ?? "",
    createdAt: r.createTime ?? ""
  };
  if (r.reviewReply?.comment) {
    review.reply = { text: r.reviewReply.comment, updatedAt: r.reviewReply.updateTime ?? "" };
  }
  return review;
}
async function getBusinessReviews(options = {}) {
  const { limit, filterMinStars, next } = options;
  if (!isBusinessProfileConfigured()) return EMPTY;
  const token = await getGoogleOAuthAccessToken();
  if (!token) return EMPTY;
  const account = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
  const location = process.env.GOOGLE_BUSINESS_LOCATION_ID;
  const raw = [];
  let averageRating;
  let totalReviewCount;
  let pageToken;
  do {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/reviews?orderBy=updateTime%20desc&pageSize=${MAX_PAGE_SIZE}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const fetchOptions = {
      headers: { Authorization: `Bearer ${token}` },
      next: next ?? { revalidate: 3600, tags: ["google-reviews"] }
    };
    const res = await fetch(endpoint, fetchOptions);
    if (!res.ok) {
      throw new Error(`Business Profile reviews failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    raw.push(...data.reviews ?? []);
    averageRating = data.averageRating ?? averageRating;
    totalReviewCount = data.totalReviewCount ?? totalReviewCount;
    pageToken = data.nextPageToken;
  } while (pageToken && (limit === void 0 || raw.length < limit));
  const reviews = raw.filter((r) => r.comment && r.starRating).filter((r) => filterMinStars === void 0 || STAR_VALUES[r.starRating] >= filterMinStars).slice(0, limit).map(toBusinessReview);
  return {
    averageRating: averageRating ?? null,
    totalReviewCount: totalReviewCount ?? reviews.length,
    reviews
  };
}
export {
  getBusinessReviews,
  getGoogleOAuthAccessToken,
  hasGoogleOAuthCredentials,
  isBusinessProfileConfigured
};
