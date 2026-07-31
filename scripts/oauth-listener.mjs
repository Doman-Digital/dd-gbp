#!/usr/bin/env node
/**
 * One-time local OAuth flow to mint a client's own GBP_REFRESH_TOKEN. Opens
 * a consent URL for the business owner to complete in their browser, catches
 * the redirect on a local listener, exchanges the code, looks up the
 * account/location IDs, and writes all three values straight to Doppler --
 * they are never printed to stdout or returned from this process.
 *
 * Run from inside the CLIENT repo (so `doppler secrets set` targets that
 * client's own project/config via its local .doppler.yaml scoping), with
 * GBP_CLIENT_ID / GBP_CLIENT_SECRET already in the environment:
 *
 *   cd ~/code/personal/RMP-Electrical
 *   GBP_CLIENT_ID=$(doppler secrets get GBP_CLIENT_ID --plain) \
 *   GBP_CLIENT_SECRET=$(doppler secrets get GBP_CLIENT_SECRET --plain) \
 *     node ~/code/personal/dd-gbp/scripts/oauth-listener.mjs
 *
 * Requires http://127.0.0.1:3333/oauth2callback registered as an authorized
 * redirect URI on the GBP OAuth client in GCP Console -- add it once if
 * Google returns redirect_uri_mismatch.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

const REDIRECT = "http://127.0.0.1:3333/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

const clientId = process.env.GBP_CLIENT_ID?.trim();
const clientSecret = process.env.GBP_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error("Set GBP_CLIENT_ID and GBP_CLIENT_SECRET in the environment first.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

/** Value travels via argv straight to the child process -- never through
 * this script's own stdout/stderr, so it can't land in a captured log. */
function dopplerSet(name, value) {
  execFileSync("doppler", ["secrets", "set", `${name}=${value}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

async function exchangeCode(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function lookupAccountAndLocation(accessToken) {
  const accountsRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!accountsRes.ok) {
    throw new Error(`accounts.list failed: ${accountsRes.status} ${await accountsRes.text()}`);
  }
  const { accounts } = await accountsRes.json();
  if (!accounts?.length) throw new Error("No Business Profile accounts visible to this login.");
  const accountId = accounts[0].name.split("/").pop();

  const locationsRes = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!locationsRes.ok) {
    throw new Error(`locations.list failed: ${locationsRes.status} ${await locationsRes.text()}`);
  }
  const { locations } = await locationsRes.json();
  if (!locations?.length) throw new Error("No locations found on this account.");
  if (locations.length > 1) {
    console.log(`Multiple locations found; using the first (${locations[0].title}). All locations seen:`);
    for (const l of locations) console.log(` - ${l.title} (${l.name})`);
  }
  const locationId = locations[0].name.split("/").pop();
  return { accountId, locationId, locationTitle: locations[0].title };
}

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");

  if (err) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<p>OAuth error: ${err}</p>`);
    console.error("OAuth error:", err);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<p>No code in callback.</p>");
    server.close();
    process.exit(1);
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh_token returned -- revoke this app's access at " +
          "https://myaccount.google.com/permissions and re-run (a prior grant can " +
          "suppress issuing a new one even with prompt=consent).",
      );
    }

    dopplerSet("GBP_REFRESH_TOKEN", tokens.refresh_token);
    console.log("GBP_REFRESH_TOKEN written to Doppler.");

    const { accountId, locationId, locationTitle } = await lookupAccountAndLocation(tokens.access_token);
    dopplerSet("GOOGLE_BUSINESS_ACCOUNT_ID", accountId);
    dopplerSet("GOOGLE_BUSINESS_LOCATION_ID", locationId);
    console.log(`GOOGLE_BUSINESS_ACCOUNT_ID / GOOGLE_BUSINESS_LOCATION_ID written for "${locationTitle}".`);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<p>Done -- credentials written to Doppler. You can close this tab.</p>");
  } catch (e) {
    console.error(e.message ?? e);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<p>Failed -- see terminal. ${String(e.message ?? e)}</p>`);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(3333, () => {
  console.log("Open this URL and complete consent as the business owner:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting on http://127.0.0.1:3333/oauth2callback ...\n");
});
