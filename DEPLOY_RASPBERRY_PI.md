# Deploying swe-duolingo on a Raspberry Pi 5 (Cloudflare Tunnel)

This guide runs the whole stack — Postgres, the Rust API, and the Expo web app —
on a Raspberry Pi 5, exposed to the internet through a **Cloudflare Tunnel**.

Cloudflare terminates HTTPS at its edge and reaches the Pi over an **outbound-only**
tunnel, so you need **no port-forwarding, no public IP, and no Let's Encrypt** on the
Pi. Everything runs in Docker and builds natively for the Pi's arm64 CPU.

```
Internet ──HTTPS──▶ Cloudflare edge ──outbound tunnel──▶ cloudflared ──http──▶ web (nginx:80)
                                                                                 └─proxy─▶ api:3001
```

---

## 0. What you need

- A Raspberry Pi 5 running **64-bit Raspberry Pi OS** (Bookworm) — verify with `uname -m` → `aarch64`.
- A domain managed by **Cloudflare** (the domain's nameservers point to Cloudflare).
- A **GitHub OAuth App** (for login).

---

## 1. Install Docker on the Pi

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker          # or log out / back in
docker compose version # confirm the compose plugin is present
```

---

## 2. Get the code onto the Pi

```bash
git clone https://github.com/SaltyRucula/swe-duolingo.git
cd swe-duolingo
```

> Private repo? Either use a GitHub Personal Access Token when prompted, add the
> Pi's SSH key as a deploy key, or just `scp`/`rsync` the folder over from your Mac
> (exclude `.git`, `node_modules`, `api-rust/target`, and `.env`).

---

## 3. Create the Cloudflare Tunnel

1. Go to the **Cloudflare Zero Trust** dashboard → **Networks → Tunnels**.
2. **Create a tunnel** → choose **Cloudflared** → give it a name (e.g. `swelingo-pi`) → **Save**.
3. On the "Install connector" screen, **copy the tunnel token** (the long string after
   `--token`). You only need the token — the `docker-compose.pi.yml` already runs the connector.
4. Open the tunnel's **Public Hostname** tab → **Add a public hostname**:
   - **Subdomain / Domain:** the hostname you want (e.g. `swelingo.com` or `app.yourdomain.com`)
   - **Service Type:** `HTTP`
   - **URL:** `web:80`   ← the Docker service name, reachable by cloudflared on the internal network
5. Save. Cloudflare creates the DNS record for you automatically.

---

## 4. Configure the environment

```bash
cp .env.pi.example .env
nano .env
```

Fill in:

| Variable | Value |
| --- | --- |
| `TUNNEL_TOKEN` | the token you copied in step 3 |
| `EXPO_PUBLIC_API_URL` / `API_BASE_URL` / `WEB_URL` | `https://yourdomain.com` (the hostname from step 4 — all three the same) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from your GitHub OAuth App |
| `JWT_SECRET` | `openssl rand -hex 64` |
| `POSTGRES_PASSWORD` | a strong password |

> `EXPO_PUBLIC_API_URL` is **baked into the web bundle at build time**, so it must be
> the final public URL before you build. Web and API share one origin (nginx proxies
> the API paths), so there is no separate API hostname or `:3001` in any URL.

---

## 5. Point GitHub OAuth at the new domain

In your GitHub OAuth App (https://github.com/settings/developers), set the
**Authorization callback URL** to:

```
https://yourdomain.com/auth/github/callback
```

---

## 6. Build and run

```bash
docker compose -f docker-compose.pi.yml up -d --build
```

> **First build is slow.** The Rust API compiles single-threaded (`-j1`) to stay within
> the Pi's RAM — expect ~15–40 min on first build. Later builds reuse cached layers.
> See *Faster builds* below to cross-build on your Mac instead.

Check status and logs:

```bash
docker compose -f docker-compose.pi.yml ps
docker compose -f docker-compose.pi.yml logs -f cloudflared   # should say "Registered tunnel connection"
docker compose -f docker-compose.pi.yml logs -f api
```

Then open `https://yourdomain.com` — you should get a valid Cloudflare TLS cert and the app.

---

## 7. Updating / redeploying

```bash
git pull
docker compose -f docker-compose.pi.yml up -d --build
```

To wipe the database and start fresh: `docker compose -f docker-compose.pi.yml down -v`.

---

## Faster builds (optional): cross-build on your Mac

Compiling Rust on the Pi is slow. You can build the arm64 images on your Mac with
Buildx and push them to a registry (e.g. GitHub Container Registry under `SaltyRucula`),
then just `pull` on the Pi:

```bash
# on the Mac
docker buildx build --platform linux/arm64 \
  -t ghcr.io/saltyrucula/swelingo-api:latest ./api-rust --push
docker buildx build --platform linux/arm64 \
  --build-arg EXPO_PUBLIC_API_URL=https://yourdomain.com \
  -f Dockerfile.web -t ghcr.io/saltyrucula/swelingo-web:latest . --push
```

Then swap the `build:` blocks in `docker-compose.pi.yml` for `image:` references and run
`docker compose -f docker-compose.pi.yml up -d` on the Pi.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `cloudflared` keeps restarting / "error parsing token" | `TUNNEL_TOKEN` is wrong or quoted — paste the raw token, no quotes. |
| 502 from Cloudflare | The public hostname URL must be `web:80` (not `localhost`). Confirm `web` is running: `docker compose -f docker-compose.pi.yml ps`. |
| OAuth redirects to the wrong place / fails | `API_BASE_URL`/`WEB_URL` must be `https://yourdomain.com` and the GitHub callback URL must match exactly (step 5). |
| API can't reach the DB | Wait for the `postgres` healthcheck; check `DATABASE_URL` and `POSTGRES_PASSWORD` match. |
| Rust build killed (OOM) on an 8 GB Pi | It already uses `-j1`; close other apps, or cross-build on the Mac (above). |
| `uname -m` shows `armv7l` | You're on 32-bit OS — reflash 64-bit Raspberry Pi OS. |
