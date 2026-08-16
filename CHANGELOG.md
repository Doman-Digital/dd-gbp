# Changelog

All notable changes to `@domandigital/gbp`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.3.1 were consumed as git dependencies pinned to a tag. This
file was written retroactively from that tag history, so entries below 0.3.1
describe what the diffs actually changed rather than what was recorded at the
time.

## [Unreleased]

### Added

- `./package.json` is now exposed in the `exports` map. Tooling that reads a
  dependency's manifest previously hit `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `@types/node` is declared as a devDependency, and `tsconfig.json` sets
  `"types": ["node"]`. This package uses `process.env`, `fetch`,
  `URLSearchParams`, `RequestInit` and `Response`, all of which need those
  types, and none of which had a declared source. `pnpm typecheck` passed only
  because TypeScript walks up past the repo root and can find an `@types/node`
  installed elsewhere on the machine. No consumer was affected, since published
  `.d.ts` files carry their own references, but the check was not real.
- CI on every push and pull request: typecheck, test and build across Node 20,
  22 and 24. Previously the only workflow was the tag-triggered release.
- README section covering `scripts/oauth-listener.mjs`, the one-time local flow
  that mints a client's `GBP_REFRESH_TOKEN` and writes it straight to Doppler.
  It shipped in 0.3.0 with no documentation at all.

### Changed

- `engines.node` raised from `>=18` to `>=20`. Node 18 reached end of life in
  April 2025, and the previous range was never exercised by anything.
- README rewritten for npm distribution. The install section still described the
  package as unpublished and pointed at the `#v0.1.0` git tag.

## [0.3.0] - 2026-08-16

### Added

- `scripts/oauth-listener.mjs`: a one-time local OAuth flow that prints a
  consent URL, catches Google's redirect on a local listener, exchanges the
  code, looks up the account and location IDs, and writes all three values to
  Doppler. The token never passes through stdout, so it can't land in a
  captured log.

  This script is not part of the published package. It isn't in `files`, so it's
  absent from the npm tarball: it shells out to the `doppler` binary, which has
  no place in a public library's runtime contract. Clone the repo to use it.

### Fixed

- The pagination test asserted a fixed order against a result the library
  deliberately shuffles. With two reviews a shuffle returns the input order
  about half the time, so the test failed roughly 50% of runs and survived two
  releases because nothing ran the suite automatically. It now compares the set
  of ids.

### Changed

- Licensed Apache-2.0, with publish metadata and `publishConfig` for public
  access and provenance. First version published to the npm registry.

## [0.2.0] - 2026-07-31

### Changed

- **`getBusinessReviews` now returns reviews in random order.** Results are
  shuffled before being returned, replacing the API's own
  `orderBy=updateTime desc` ordering. There is no way to opt out.

  Two consequences worth knowing before you upgrade from 0.1.0: output is not
  stable across builds, so a statically generated testimonial section reorders
  on every rebuild; and because the shuffle runs after `limit` is applied, you
  get the most recent N reviews in random order rather than a random N.

  (The 0.2.0 tag message also credits min-star filtering. That's inaccurate:
  `filterMinStars` shipped in 0.1.0.)

## [0.1.0] - 2026-07-30

### Added

- Initial release, extracted from MMM Beauty's `packages/google-apis`. Zero
  runtime dependencies.
- `getGoogleOAuthAccessToken` and `hasGoogleOAuthCredentials`: user
  refresh-token OAuth, with the access token cached in process and refreshed a
  minute before expiry. Service accounts are rejected by the Business Profile
  API entirely, so this is the only auth route.
- `getBusinessReviews` and `isBusinessProfileConfigured`: a paginated reviews
  fetch (the API caps each page at 50) that decodes Google's star-rating enums,
  includes the business's reply to each review, and supports `limit`,
  `filterMinStars` and a Next.js `next` cache hint. Returns empty results rather
  than throwing when unconfigured, so UI can render unconditionally.

[Unreleased]: https://github.com/Doman-Digital/dd-gbp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Doman-Digital/dd-gbp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Doman-Digital/dd-gbp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Doman-Digital/dd-gbp/releases/tag/v0.1.0
