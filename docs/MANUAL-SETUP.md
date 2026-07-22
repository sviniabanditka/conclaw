# Manual setup

Everything `/setup` cannot do for you, because it happens in a browser, in a
Google console, or in your cluster. Each section says what breaks if you skip
it, and how to tell.

Skipping any of these is fine — the feature stays off. What is not fine is
skipping one and expecting the feature to work, because the symptom is a
capability that was **never** there rather than one that stopped, and that
reads like a bug.

---

## OneCLI gateway

The credential system. Containers hold no secrets; the gateway injects them
into outbound HTTPS at request time.

`/init-onecli` installs it. Two settings are not defaults and are easy to miss:

**Bind on all interfaces.** In `~/.onecli/docker-compose.yml` the ports must be
published on `0.0.0.0`, not `127.0.0.1`. Agent containers reach the gateway
across the docker bridge, and a loopback bind is invisible from there.

**Point the CLI at the right address.** In `~/.onecli/.env`:

```
ONECLI_APP_URL=http://localhost:10254
ONECLI_GATEWAY_URL=http://172.17.0.1:10255
```

The gateway URL is the docker bridge address, not localhost — that is what
containers use.

**The Anthropic secret.** `/refresh-token` creates and maintains it. Note the
shape it uses: a **generic** secret with the header spelled out —

```
--type generic --host-pattern api.anthropic.com --path-pattern '/*'
--header-name Authorization --value-format 'Bearer {value}'
```

The typed `--type anthropic` variant stopped resolving in the gateway: it lists
fine and matches the host, and every request comes back `credential_not_found`.

**Check:** `/verify` → `CREDENTIAL_WORKS: yes`. That runs a real authenticated
request and is the only check that tells a credential that *resolves* from one
that merely exists.

---

## Telegram bot

`/add-telegram` handles the token and registration. Two things live only in
@BotFather:

**The bot itself** — `/newbot`, then paste the token when the skill asks.

**The Mini App** — only if you want the web interface. Bot Settings → Menu
Button → set the URL to `https://<your-domain>/`. Without it the app is
unreachable from Telegram even though the server is running and healthy.

**Check:** `/verify` → `REGISTERED_GROUPS: 1` and, for the app, opening the
menu button.

---

## Google Calendar

`/add-gcal-tool` does the wiring. The OAuth application is yours to create:

1. Google Cloud console → new project → enable the Google Calendar API.
2. OAuth consent screen. If you publish to production you cannot also be a test
   user — that is expected, publishing is what removes the test-user list.
3. Credentials → OAuth client ID → **Web application**.
4. Authorised redirect URI — take it from OneCLI's own authorize redirect
   rather than guessing. For this deployment it is
   `http://localhost:10254/v1/apps/google-calendar/callback`.
5. Paste the client id and secret into OneCLI → Apps → Google Calendar.

**Check:** `/verify` → `CALENDAR: configured`, then ask the bot what is on your
calendar today.

---

## Mini App domain

The app needs public HTTPS with a certificate Telegram trusts; a self-signed
one shows a blank screen in the client with nothing in the console.

1. Point a DNS record at your cluster.
2. Edit `deploy/k3s/miniapp.yaml` — the host appears twice — and set the TLS
   issuer annotation to whatever issues your certificates, or delete it if you
   terminate TLS elsewhere.
3. `kubectl apply -f deploy/k3s/miniapp.yaml`
4. In `.env`: `MINIAPP_PORT=10256` and `MINIAPP_ALLOWED_USER_IDS=<your numeric
   Telegram id>`.

The allowlist is the whole security boundary. Everything served is reachable by
anyone who learns the URL, and every Telegram user gets a validly signed
`initData` for their own account — the signature proves the request came from
Telegram, not that it came from you. With the list empty ConClaw refuses to open
the port at all.

**Check:** `curl https://<domain>/healthz` → `{"ok":true}`, and
`curl https://<domain>/api/links` → `401`.

---

## Voice transcription

`bash scripts/install-transcription.sh` — about 600 MB and a few minutes of
compiling, no root needed. Then put the three absolute paths it prints into
`.env`.

They must be absolute. The service's PATH is not your shell's, and a bare
`ffmpeg` that resolves for you can fail for the daemon — this install lost
transcription for a day that way, and the agent invented explanations for it
rather than reporting the real cause.

**Check:** `/verify` → `TRANSCRIPTION: ready`.

---

## Token refresh

`/refresh-token` installs the script and the loop that keeps the OAuth
credential alive.

**Do not skip this one.** Nothing notices its absence until the token expires a
few hours later, at which point every reply fails with a 401 that looks like a
broken key rather than a missing scheduler. On a host with no cron the loop runs
under tmux, and the k3s bootstrap starts it — but only if the file is there, and
it says so loudly when it is not.

**Check:** `/verify` → `TOKEN_REFRESH: running`.
