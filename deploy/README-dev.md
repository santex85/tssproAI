# Dev server (dev.tsspro.tech)

Сервер для тестирования. Обычно работаем в ветке **dev**, выкатываем её сюда, проверяем, затем мержим в **main** и деплоим на production. Полный цикл: [docs/WORKFLOW.md](../docs/WORKFLOW.md).

## DNS

Create A records pointing to dev server IP (from `DEV_DEPLOY_HOST` in deploy.env):
- **dev.tsspro.tech** → dev server IP (landing)
- **dev.app.tsspro.tech** → dev server IP (app)

## Deploy (first time and later)

Из ветки, которую нужно протестировать (обычно `dev`), с локальной машины:

```bash
make deploy-dev
```

Без пуша в git (код уже в origin): `make deploy-dev-no-push`.

**Что происходит:** `deploy-dev` вызывает `ensure-dev-server` (идемпотентно), пушит **текущую ветку** в origin, на сервере делает checkout этой ветки, pull, сборку образов, `docker stack deploy`, миграции. На production всегда катится только `main` (`make deploy`).

**ensure-dev-server**:

1. Runs **bootstrap-dev** (Docker + Swarm, create deploy dir) if needed.
2. **Clones the repo** into `DEV_DEPLOY_PATH` if the directory is not a git repo (uses `git remote get-url origin` as `REPO_URL`; for private repos the server must have git credentials).
3. If **`.env` is missing**, copies `.env.development.example` (or `.env.production.example`) to `.env`, prints instructions, and exits with an error so you fill secrets before deploying.

**First-time only:** If `.env` was just created, the command will stop and ask you to fill secrets. SSH to the server, edit `.env` (e.g. `nano /root/smart_trainer/.env`), set `DOMAIN=dev.tsspro.tech`, `APP_DOMAIN=dev.app.tsspro.tech`, `VITE_APP_URL=https://dev.app.tsspro.tech`, `EXPO_PUBLIC_API_URL=https://dev.app.tsspro.tech`, `CORS_ORIGINS`, `POSTGRES_PASSWORD`, API keys, S3, Stripe test keys, etc. Then run `make deploy-dev` again.

## Check after deploy

- https://dev.tsspro.tech — лендинг
- https://dev.app.tsspro.tech — приложение
- Логи на сервере: `docker service logs st2_caddy`, `st2_backend`, `st2_frontend`.
- Два окружения и команды: см. [docs/DEPLOY.md](../docs/DEPLOY.md) (таблица в начале).
