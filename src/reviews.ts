/**
 * Google Business Profile -- fetch the business's own reviews, including the
 * business's reply to each one. Free (no per-call billing, unlike Places
 * API), and because these are your own reviews via the Business Profile API
 * there are no Places display / caching restrictions.
 *
 * Auth is OAuth user refresh-token, not a service account -- service accounts
 * are rejected by this API entirely. See ./oauth-client.ts.
 *
 * A review's reply has no author field of its own: GBP replies are 1:1 (one
 * slot per review) and always from the business -- there's no third party to
 * disambiguate. Google's own UI renders it as "Response from the owner" for
 * the same reason. Attribute it to the business in the consumer, not here.
 *
 * Access caveat: the Business Profile APIs require a one-time access request
 * / approval from Google, and reviews live on the legacy `mybusiness v4`
 * endpoint which must be enabled on your Cloud project. Until that is
 * granted, every function here degrades gracefully to empty results.
 *
 * Env: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN,
 * GOOGLE_BUSINESS_ACCOUNT_ID, GOOGLE_BUSINESS_LOCATION_ID.
 */

import { getGoogleOAuthAccessToken, hasGoogleOAuthCredentials } from "./oauth-client";

// This package has no dependency on "next" (deliberately zero-dependency), so
// the `next: {...}` fetch cache-hint option Next.js apps augment RequestInit
// with isn't in scope here -- declared locally instead. A no-op outside Next.js.
interface NextFetchInit extends RequestInit {
  next?: { revalidate?: number; tags?: string[] };
}

// Google encodes star ratings as enum strings.
const STAR_VALUES: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

const MAX_PAGE_SIZE = 50;

export interface ReviewReply {
  text: string;
  /** ISO 8601, when the reply was last posted/edited. */
  updatedAt: string;
}

export interface BusinessReview {
  id: string;
  author: string;
  authorPhoto?: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string; // ISO
  reply?: ReviewReply;
}

export interface BusinessReviewsResult {
  averageRating: number | null;
  totalReviewCount: number;
  reviews: BusinessReview[];
}

const EMPTY: BusinessReviewsResult = {
  averageRating: null,
  totalReviewCount: 0,
  reviews: [],
};

/** True when account + location + OAuth credentials are all configured. */
export function isBusinessProfileConfigured(): boolean {
  return (
    hasGoogleOAuthCredentials() &&
    Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID) &&
    Boolean(process.env.GOOGLE_BUSINESS_LOCATION_ID)
  );
}

interface RawReview {
  reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

interface RawReviewsPage {
  reviews?: RawReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

export interface GetBusinessReviewsOptions {
  /** Max reviews to return (default: all of them, paginated). */
  limit?: number;
  /**
   * When set, only reviews at or above this star rating are returned -- for
   * public-facing social proof (e.g. a marketing site's testimonial feed).
   * Omit to return every review including low ratings, for an owner-facing
   * surface where the point is to see and respond to everything.
   */
  filterMinStars?: number;
  /** Cache-hint passed straight through to `fetch`'s Next.js augmentation.
   * A no-op outside Next.js. Default: revalidate hourly. */
  next?: { revalidate?: number; tags?: string[] };
}

function toBusinessReview(r: RawReview): BusinessReview {
  const review: BusinessReview = {
    id: r.reviewId,
    author: r.reviewer?.displayName ?? "Anonymous",
    authorPhoto: r.reviewer?.profilePhotoUrl,
    rating: STAR_VALUES[r.starRating ?? "FIVE"] ?? 5,
    comment: r.comment ?? "",
    createdAt: r.createTime ?? "",
  };
  if (r.reviewReply?.comment) {
    review.reply = { text: r.reviewReply.comment, updatedAt: r.reviewReply.updateTime ?? "" };
  }
  return review;
}

/**
 * Fetch reviews for the configured location, paginating through all pages
 * (GBP caps each page at 50). Returns empty results (never throws on missing
 * config) so UI can render unconditionally.
 */
export async function getBusinessReviews(
  options: GetBusinessReviewsOptions = {},
): Promise<BusinessReviewsResult> {
  const { limit, filterMinStars, next } = options;

  if (!isBusinessProfileConfigured()) return EMPTY;

  const token = await getGoogleOAuthAccessToken();
  if (!token) return EMPTY;

  const account = process.env.GOOGLE_BUSINESS_ACCOUNT_ID!;
  const location = process.env.GOOGLE_BUSINESS_LOCATION_ID!;

  const raw: RawReview[] = [];
  let averageRating: number | undefined;
  let totalReviewCount: number | undefined;
  let pageToken: string | undefined;

  do {
    const endpoint =
      `https://mybusiness.googleapis.com/v4/accounts/${account}` +
      `/locations/${location}/reviews?orderBy=updateTime%20desc&pageSize=${MAX_PAGE_SIZE}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

    // Typed as a variable (not inline) so the `next` cache hint -- a Next.js
    // RequestInit augmentation this zero-dependency package doesn't import --
    // doesn't trip excess-property checking against the plain RequestInit
    // fetch() expects.
    const fetchOptions: NextFetchInit = {
      headers: { Authorization: `Bearer ${token}` },
      next: next ?? { revalidate: 3600, tags: ["google-reviews"] },
    };
    const res = await fetch(endpoint, fetchOptions);

    if (!res.ok) {
      throw new Error(`Business Profile reviews failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as RawReviewsPage;
    raw.push(...(data.reviews ?? []));
    averageRating = data.averageRating ?? averageRating;
    totalReviewCount = data.totalReviewCount ?? totalReviewCount;
    pageToken = data.nextPageToken;
  } while (pageToken && (limit === undefined || raw.length < limit));

  const reviews: BusinessReview[] = raw
    .filter((r) => r.comment && r.starRating)
    .filter((r) => filterMinStars === undefined || STAR_VALUES[r.starRating!] >= filterMinStars)
    .slice(0, limit)
    .map(toBusinessReview);

  return {
    averageRating: averageRating ?? null,
    totalReviewCount: totalReviewCount ?? reviews.length,
    reviews,
  };
}
