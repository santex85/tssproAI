# Dev server (dev.tsspro.tech, 209.38.17.171)

## DNS

Create an A record: **dev.tsspro.tech** → **209.38.17.171**.

## Deploy (first time and later)

From your machine run:

```bash
make deploy-dev
```

Or without pushing to git first: `make deploy-dev-no-push`.

**What it does:** `deploy-dev` runs `ensure-dev-server` (idempotent), then `git push`, then deploy on the server. Under the hood, `ensure-dev-server`:

1. Runs **bootstrap-dev** (Docker + Swarm, create deploy dir) if needed.
2. **Clones the repo** into `DEV_DEPLOY_PATH` if the directory is not a git repo (uses `git remote get-url origin` as `REPO_URL`; for private repos the server must have git credentials).
3. If **`.env` is missing**, copies `.env.development.example` (or `.env.production.example`) to `.env`, prints instructions, and exits with an error so you fill secrets before deploying.

**First-time only:** If `.env` was just created, the command will stop and ask you to fill secrets. SSH to the server, edit `.env` (e.g. `nano /root/smart_trainer/.env`), set `DOMAIN=dev.tsspro.tech`, `CORS_ORIGINS`, `POSTGRES_PASSWORD`, API keys, S3, Stripe test keys, etc. Then run `make deploy-dev` again.

## Check after deploy

- Open https://dev.tsspro.tech — frontend should load via Caddy.
- Logs on server: `docker service logs st2_caddy`, `st2_backend`, `st2_frontend`.
