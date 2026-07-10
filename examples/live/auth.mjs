// Handles Google OAuth for the live harness: a one-time browser consent
// flow, then cached, auto-refreshing tokens for every run after that.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(dir, "credentials.json");
const TOKEN_PATH = path.join(dir, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

function printSetupInstructions() {
  console.error(`
No Google OAuth credentials found at:
  ${CREDENTIALS_PATH}

One-time setup (about 5 minutes):
  1. Create or pick a Google Cloud project:
     https://console.cloud.google.com/projectcreate
  2. Enable the Calendar API for it:
     https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
  3. Configure the OAuth consent screen (External, Testing mode is fine —
     add your own Google account as a test user):
     https://console.cloud.google.com/apis/credentials/consent
  4. Create credentials -> OAuth client ID -> Application type: Desktop app:
     https://console.cloud.google.com/apis/credentials
  5. Download the JSON and save it exactly as:
     ${CREDENTIALS_PATH}

Then run this script again. (Note: in Testing mode, Google expires the
refresh token after ~7 days of inactivity — just re-run the consent flow
by deleting ${path.basename(TOKEN_PATH)} if auth starts failing.)
`);
}

export async function getAuthedClient() {
  if (!existsSync(CREDENTIALS_PATH)) {
    printSetupInstructions();
    process.exit(1);
  }
  const raw = JSON.parse(await readFile(CREDENTIALS_PATH, "utf8"));
  const creds = raw.installed ?? raw.web;
  if (!creds) {
    console.error("credentials.json doesn't look like a Desktop app OAuth client (missing 'installed' key).");
    process.exit(1);
  }
  const client = new OAuth2Client(creds.client_id, creds.client_secret);
  client.on("tokens", (tokens) => persistTokens(client, tokens));

  if (existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(await readFile(TOKEN_PATH, "utf8")));
    return client;
  }

  const tokens = await runConsentFlow(client);
  client.setCredentials(tokens);
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return client;
}

async function persistTokens(client, tokens) {
  await writeFile(TOKEN_PATH, JSON.stringify({ ...client.credentials, ...tokens }, null, 2));
}

function runConsentFlow(client) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      const code = url.searchParams.get("code");
      if (!code) return;
      res.end("Authorized — you can close this tab and return to the terminal.");
      server.close();
      const redirectUri = `http://localhost:${server.address().port}`;
      client
        .getToken({ code, redirect_uri: redirectUri })
        .then(({ tokens }) => resolve(tokens))
        .catch(reject);
    });
    server.listen(0, "localhost", () => {
      const redirectUri = `http://localhost:${server.address().port}`;
      const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES, redirect_uri: redirectUri });
      console.error(`\nOpening your browser for Google sign-in. If it doesn't open, visit:\n${authUrl}\n`);
      exec(`open ${JSON.stringify(authUrl)}`, () => {});
    });
  });
}
