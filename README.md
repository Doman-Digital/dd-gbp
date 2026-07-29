# @domandigital/gbp

A zero-dependency Google Business Profile client for Doman Digital / IDS
client sites: OAuth refresh-token auth and a paginated reviews fetch,
including the business's own reply to each review.

## Why this exists

Extracted from MMM Beauty's `packages/google-apis` (`business-profile.ts` +
`oauth-client.ts`), which was already proven in production against the
real GBP API's quirks -- star-rating enums, page-size caps, graceful
degrade-to-empty when unconfigured. Six client sites need this, not one, so
it moved out into its own package rather than being copy-pasted five more
times. That's the exact drift `@domandigital/graph` already exists to
prevent, one layer down: OAuth + pagination + enum-decoding logic
independently reinvented per repo instead of fixed once.

This package does **not** depend on `@domandigital/graph` and vice versa.
`gbp` fetches review facts; `graph` turns facts into JSON-LD. A consuming
site composes them at the call site:

```ts
import { getBusinessReviews } from "@domandigital/gbp";
import { buildReview, createGraphIds } from "@domandigital/graph";

const { reviews, averageRating, totalReviewCount } = await getBusinessReviews();
const reviewNodes = reviews.map((r) =>
  buildReview(
    {
      authorName: r.author,
      reviewBody: r.comment,
      ratingValue: r.rating,
      datePublished: r.createdAt,
      reply: r.reply ? { text: r.reply.text, dateCreated: r.reply.updatedAt } : null,
    },
    ids,
  ),
);
```

`averageRating` / `totalReviewCount` feed `OrganizationInput.aggregateRating`
directly -- don't hardcode a rating/count literal in a site's settings file
once this is wired in. That literal drifting from the real listing (a site
claiming 7 reviews when Google has 6) is the bug this package exists to kill.

## Why Business Profile API, not Places API

Places API's `Review` object has no field for the business's reply, full
stop -- and caps out at 5 reviews per place with no pagination. Neither
limitation applies here: this uses the Business Profile API (the same one
you already manage the listing through), which returns every review, paginated,
with the reply attached, for free.

## Install

Not published to npm. Consumed as a git dependency pinned to a tag:

```json
{
  "dependencies": {
    "@domandigital/gbp": "github:Doman-Digital/dd-gbp#v0.1.0"
  }
}
```

`dist/` is committed to this repo (no CI build step runs on a git-dependency
install), so no build step is required in the consuming project beyond a
normal `pnpm install`.

## Env

| Var | Purpose |
|---|---|
| `GBP_CLIENT_ID` | Google Cloud OAuth client id |
| `GBP_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `GBP_REFRESH_TOKEN` | User refresh token (service accounts are rejected by this API) |
| `GOOGLE_BUSINESS_ACCOUNT_ID` | e.g. `accounts/1234567890` |
| `GOOGLE_BUSINESS_LOCATION_ID` | e.g. `locations/9876543210` |

Which actual Google Cloud OAuth client + refresh token you point at (the
agency's shared credential, or a business's own dedicated one) is entirely a
deployment-env decision, not a code-level one -- each app configures its own.

## API

### `getBusinessReviews(options?): Promise<BusinessReviewsResult>`

Paginates through every review (GBP caps each page at 50) and returns:

```ts
interface BusinessReviewsResult {
  averageRating: number | null;
  totalReviewCount: number;
  reviews: BusinessReview[];
}

interface BusinessReview {
  id: string;
  author: string;
  authorPhoto?: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string; // ISO
  reply?: { text: string; updatedAt: string }; // no author field -- see below
}
```

Options:

- `limit?: number` -- stop paginating once this many reviews are collected.
  Omit to fetch all of them.
- `filterMinStars?: number` -- drop reviews below this rating. Use for a
  public testimonial feed; omit for an owner-facing surface where the point
  is to see everything. `totalReviewCount` always reflects the location's
  real total, never the filtered count.
- `next?: { revalidate?: number; tags?: string[] }` -- passed straight through
  to `fetch`'s Next.js cache-hint augmentation. A no-op outside Next.js.
  Default: revalidate hourly.

Never throws on missing configuration -- `isBusinessProfileConfigured()` gates
internally and returns an empty result, so UI can render unconditionally.
Does throw on a real API failure (non-OK response), so a calling route should
catch and degrade explicitly if it wants zero-downtime behavior on a Google
outage.

### Why a reply has no author field

A GBP review has exactly one reply slot, and it can only ever come from the
business -- there is no third party to disambiguate, so the API returns
`{ comment, updateTime, reviewReplyState }` with nothing else. Google's own
listing UI renders every reply as "Response from the owner" for the same
reason. Attribute it to the business's own Organization node in the
consumer (see the `@domandigital/graph` composition example above) --
don't go looking for an author field that doesn't exist.

### `isBusinessProfileConfigured(): boolean`

True once all five env vars above are set.

### `hasGoogleOAuthCredentials()` / `getGoogleOAuthAccessToken()`

Lower-level OAuth primitives, exported in case a consumer needs the raw
access token for another Business Profile endpoint this package doesn't wrap
(e.g. business hours, Q&A). The token is cached in-process and refreshed a
minute before expiry.
