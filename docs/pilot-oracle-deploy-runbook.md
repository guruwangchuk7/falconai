# Beta deploy runbook — Oracle Cloud Always-Free ($0 host)

Stand up the **memory-layer beta** (Personal Falcon Q&A + Decision Memory + in-meeting listener) on an Oracle Cloud **Always-Free** VM — a real 24/7 server, free forever. This is the $0 path that sidesteps Fly. Data stays on Supabase (free) + Upstash (free). The only non-zero cost is small AI-API usage (Anthropic pay-per-use; Voyage needs a payment method or index pacing).

> **Why a VM and not a laptop+tunnel:** Falcon's **worker** must run 24/7 (background sync + scheduled jobs: poll every 10 min, TTL reaper every 30 min, silent-zero alarm hourly). A free VM is the robust always-on home for it.

---

## 0. Before you start — the hard gate + inputs
- **⛔ ROTATE THE LEAKED KEYS FIRST** (spec 003 §4 / START-HERE §0): the Supabase secret key + the `service_role` JWT. Nothing goes live until this is done.
- Oracle Cloud account (free tier).
- Supabase: owner `DATABASE_URL` (port 6543 pooler, user `postgres.<ref>`) + `falcon_app` `APP_DATABASE_URL` (non-superuser, no BYPASSRLS).
- Upstash Redis **TCP** URL (`rediss://…:6379`, NOT the REST URL).
- A **prod GitHub App** (reuse the dev one or make a `-prod` app) — App ID, slug, PKCS#8 private key, webhook secret.
- Anthropic API key. Voyage API key (add a payment method to lift the 3 RPM cap, or accept slow first-sync).
- A **domain or free subdomain** pointing at the VM (needed for HTTPS + stable OAuth callbacks — see §4). A bare IP won't work for Let's Encrypt or GitHub OAuth.
- Generate a fresh 32-byte base64 `SECRETS_KEK` for prod: `openssl rand -base64 32`.

---

## 1. Provision the VM
1. Oracle Console → **Compute → Instances → Create Instance**.
2. Image: **Ubuntu 22.04**. Shape: **Ampere A1 (ARM), Always-Free** — e.g. 1–2 OCPU / 6–12 GB (well within the free 4 OCPU / 24 GB). *(Tip: if "out of capacity" on ARM, retry in another availability domain/region, or fall back to the always-free AMD `VM.Standard.E2.1.Micro`.)*
3. Add your SSH public key. Create.
4. **Open ports 80 + 443:** VCN → the instance's **subnet → Security List → Add Ingress Rules** for TCP 80 and 443 from `0.0.0.0/0`. Then on the VM, allow them through the host firewall:
   ```bash
   sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save   # persist across reboot
   ```

## 2. Install the runtime
SSH in (`ssh ubuntu@<vm-ip>`), then:
```bash
sudo apt update && sudo apt install -y git postgresql-client
# Node 24 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 24 && nvm alias default 24
corepack enable                      # gives pnpm
npm i -g pm2                          # process manager (always-on + restart-on-reboot)
```

## 3. Get the code + build
```bash
git clone https://github.com/guruwangchuk7/falconai.git && cd falconai
pnpm install --frozen-lockfile
pnpm --filter @falcon/web build       # produces the prod .next build
```

## 4. HTTPS ingress (Caddy) — auto-TLS + reverse proxy
Point your domain's DNS **A record → the VM's public IP** first. Then:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
`/etc/caddy/Caddyfile`:
```
falcon.example.com {
    reverse_proxy localhost:3000
}
```
`sudo systemctl reload caddy` — Caddy fetches a Let's Encrypt cert automatically. Your public URL is now `https://falcon.example.com`.
> **No domain?** Use a **free DuckDNS subdomain** (`<you>.duckdns.org`) as the A record — Caddy still issues a valid Let's Encrypt cert for it. That keeps the whole host $0.
> **Alternative to Caddy:** a free **Cloudflare Tunnel** from the VM removes the need to open ports 80/443 or manage TLS at all (needs a Cloudflare-managed domain for a stable hostname). Either works; Caddy is fewer moving parts if you have a plain domain.

## 5. Environment file
Create `~/falconai/.env` (see `.env.example`). Watch the known gotchas (`reviews/`/local-run notes):
- `DATABASE_URL` = Supabase **owner** URL (migrations). `APP_DATABASE_URL` = **`falcon_app`** URL (runtime — this is what makes RLS enforce; SC-D2).
- `REDIS_URL` = Upstash **TCP** `rediss://…:6379`.
- `AUTH_SECRET` = `openssl rand -base64 32`. `AUTH_URL` = `https://falcon.example.com` (the prod origin).
- `GITHUB_APP_PRIVATE_KEY` = **PKCS#8**, single-line, `\n`-escaped, double-quoted (convert if GitHub gave you PKCS#1 `BEGIN RSA PRIVATE KEY`).
- `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SECRETS_KEK` (the fresh prod one), `SECRETS_BACKEND=file`, `SECRETS_FILE_PATH=/home/ubuntu/falconai/.secrets/store.enc.json`, Sentry/PostHog keys.
- **Do NOT set `FALCON_FAKE_LLM`** (non-prod only).
- Drop any empty optional keys entirely (empty `LANGFUSE_HOST=` etc. break zod `.url().optional()`).

## 6. Database — migrate + confirm the runtime role
```bash
cd ~/falconai && set -a && . ./.env && set +a
pnpm --filter @falcon/db migrate     # applies 0001..0010 as the owner (psql)
# confirm falcon_app exists, non-superuser, no BYPASSRLS (this is what enforces RLS):
psql "$DATABASE_URL" -tA -c "select rolname,rolsuper,rolbypassrls from pg_roles where rolname='falcon_app';"
```
If `falcon_app` is missing, create it non-superuser with SELECT/INSERT/UPDATE/DELETE grants (see `tests/support/pg.ts` for the exact grants) and point `APP_DATABASE_URL` at it.

## 7. GitHub App — prod callback wiring (the fiddly part)
On the GitHub App settings, set all URLs to the prod origin:
- Repo permissions: **Contents, Pull requests, Metadata = Read**; and the installation must **select repositories** (no repos selected → 0 artifacts).
- **Setup URL** → `https://falcon.example.com/api/integrations/github/callback` (+ "Redirect on update").
- **Auth callback** → include `https://falcon.example.com/api/auth/callback/github` (keep the `issuer` fix in `apps/web/lib/auth.ts`).
- **Webhook** → `https://falcon.example.com/api/webhooks/github` with `GITHUB_WEBHOOK_SECRET`.

## 8. Run web + worker under pm2 (always-on)
```bash
cd ~/falconai
pm2 start "pnpm --filter @falcon/web start" --name falcon-web
pm2 start "pnpm --filter @falcon/worker start" --name falcon-worker   # tsx; the 24/7 background unit
pm2 save
pm2 startup    # run the printed command → survives VM reboots
```
`pm2 logs` to watch; `pm2 restart falcon-web falcon-worker` after a `git pull` + rebuild.

## 9. Verify (spec 003 §7 — the go-live checks)
- `curl -s https://falcon.example.com/api/health` → ok.
- **Two different engineers** each: sign in with GitHub → connect repos → watch sync → ask a question → **grounded, cited answer** (SC-D1), and each sees **only their own** work (SC-D2 tenant isolation).
- `no-token-in-db` invariant on the prod DB: no OAuth-token columns (only `secret_ref`).
- Sentry/PostHog receiving events; one `query_event` per ask (SC-005 retention instrumentation).

## 10. Invite + observe
- Send the warm engineers the URL + a one-paragraph how-to + 3 starter questions.
- **Set expectations explicitly:** this is a memory/knowledge tool that *writes, post-meeting* — not live mediation.
- Watch the beta signals: retention (`query_event`), decision-extraction quality on real speech, the **silent-zero alarm** + **F7.2 omission-diff** shadow logs, and collect a labeled corpus (turn on D6 opt-in retention for consenting workspaces) → feed `pnpm --filter @falcon/db … ` + the calibration harness (`docs/calibration/`).

---

### Redeploy (after merging changes to `main`)
```bash
cd ~/falconai && git pull && pnpm install --frozen-lockfile && pnpm --filter @falcon/web build && pm2 restart falcon-web falcon-worker
```

### If Oracle isn't enough later
Graduate to any cheap managed host (Fly / Railway / a $5 VPS) — same `next start` + worker, same env. Not needed unless the free VM is outgrown or you want to stop managing the box.
