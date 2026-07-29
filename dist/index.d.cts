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
/** True when the OAuth client + refresh token are present. */
declare function hasGoogleOAuthCredentials(): boolean;
/**
 * Exchange the stored refresh token for a short-lived access token. Returns
 * `null` when credentials aren't configured so callers can degrade
 * gracefully. The token's actual scopes are whatever the refresh token was
 * granted with -- not scoped per call.
 */
declare function getGoogleOAuthAccessToken(): Promise<string | null>;

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
interface ReviewReply {
    text: string;
    /** ISO 8601, when the reply was last posted/edited. */
    updatedAt: string;
}
interface BusinessReview {
    id: string;
    author: string;
    authorPhoto?: string;
    rating: number;
    comment: string;
    createdAt: string;
    reply?: ReviewReply;
}
interface BusinessReviewsResult {
    averageRating: number | null;
    totalReviewCount: number;
    reviews: BusinessReview[];
}
/** True when account + location + OAuth credentials are all configured. */
declare function isBusinessProfileConfigured(): boolean;
interface GetBusinessReviewsOptions {
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
    next?: {
        revalidate?: number;
        tags?: string[];
    };
}
/**
 * Fetch reviews for the configured location, paginating through all pages
 * (GBP caps each page at 50). Returns empty results (never throws on missing
 * config) so UI can render unconditionally.
 */
declare function getBusinessReviews(options?: GetBusinessReviewsOptions): Promise<BusinessReviewsResult>;

export { type BusinessReview, type BusinessReviewsResult, type GetBusinessReviewsOptions, type ReviewReply, getBusinessReviews, getGoogleOAuthAccessToken, hasGoogleOAuthCredentials, isBusinessProfileConfigured };
