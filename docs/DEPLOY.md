# Деплой smart_trainer

## Два окружения (сервера)

| Окружение | Лендинг | Приложение | Сервер | Ветка | Команда |
|-----------|---------|------------|--------|-------|---------|
| **Dev** | https://dev.tsspro.tech | https://dev.app.tsspro.tech | see deploy.env | `dev` | `make deploy-dev` |
| **Production** | https://tsspro.tech | https://app.tsspro.tech | see deploy.env | `main` | `make deploy` |

- **Лендинг** (DOMAIN) — маркетинговая страница. CTA ведут на приложение.
- **Приложение** (APP_DOMAIN) — основное приложение + API + Grafana.
- **Dev** — тестирование. Dev БД сохраняется; restore из S3 — только вручную.
- **Production** — боевой сервер. Только код из `main`.

**Deploy config:** Copy `deploy.env.example` to `deploy.env` and set `DEPLOY_HOST`, `DEPLOY_TARGET`, `DEV_DEPLOY_HOST`. `deploy.env` is gitignored.

Путь на обоих серверах: `/root/smart_trainer`. На каждом свой `.env` (DOMAIN, APP_DOMAIN, CORS_ORIGINS, секреты).

**DNS:** A-записи для DOMAIN и APP_DOMAIN должны указывать на IP сервера.

---

## Phase 0: Анализ сервера и очистка (production, сделать первым)

На сервере уже есть два приложения: **одно в бэкапе (бэкап оставить)**, **второе — удалить**.

1. Подключиться по SSH: `ssh user@<production-server>` (host from `DEPLOY_HOST` in deploy.env).
2. Скопировать и запустить скрипт анализа (или выполнить команды из него вручную):
   ```bash
   # Если репозиторий уже клонирован:
   chmod +x deploy/analyze-server.sh
   ./deploy/analyze-server.sh
   ```
   Скрипт выведет: контейнеры, compose-проекты, каталоги приложений, бэкапы, cron.
3. Определить:
   - **Приложение A** — чей бэкап **оставляем** (путь к бэкапу не трогать).
   - **Приложение B** — которое **удаляем** (контейнеры + тома + каталог).
4. Удалить приложение B:
   ```bash
   cd /path/to/app_b
   docker compose down -v
   cd ..
   rm -rf /path/to/app_b
   ```
   Или запустить скрипт с путём: `./deploy/analyze-server.sh /path/to/app_b` (скрипт предложит удалить каталог).
5. Зафиксировать: путь к бэкапу A (не перезаписывать при деплое smart_trainer).

---

## 1. Подготовка сервера

- Установить Docker и Docker Compose, git (если ещё нет).
- Фаервол: открыть 80 (HTTP, для ACME), 443 (HTTPS), 22 (SSH).
- DNS: A-запись домена должна указывать на IP production-сервера (из `DEPLOY_HOST` в deploy.env).

### fail2ban (SSH и HTTP)

На хосте (с root или sudo) установить fail2ban и защитить SSH и логин/регистрацию API:

```bash
apt install -y fail2ban
```

Скопировать конфиги из репозитория (из каталога приложения на сервере):

```bash
cp deploy/fail2ban/jail.local.example /etc/fail2ban/jail.local
cp deploy/fail2ban/caddy-auth.conf.example /etc/fail2ban/filter.d/caddy-auth.conf
```

Для jail `caddy-auth` нужны логи Caddy в файле. Если Caddy в Docker пишет только в stdout, прокинуть том с доступом к логу на хост или настроить Caddy на запись access.log в файл; иначе jail `caddy-auth` не будет срабатывать (можно отключить в `jail.local`: `enabled = false`).

Перезапуск и проверка:

```bash
systemctl restart fail2ban
fail2ban-client status
fail2ban-client status sshd
fail2ban-client status caddy-auth   # если включён
```

Разбан IP при необходимости: `fail2ban-client set sshd unbanip <IP>` (или `caddy-auth` вместо `sshd`).

## 2. Ускорение сборки (сделано в проекте)

- **Frontend:** `npm ci` вместо `npm install`, BuildKit cache для npm и Expo.
- **Backend:** BuildKit cache mount для pip.
- **Selective build:** `make build-prod-backend`, `make build-prod-frontend`, `make deploy-no-push BUILD_SERVICES=backend`.
- **CI-образы:** workflow `build.yml` собирает и пушит в GHCR; деплой через `USE_CI_IMAGES=1` — без сборки на сервере.
- **Readiness:** вместо фиксированных sleep — опрос pg_isready и backend /health.

## 3. Файлы для production (в репозитории)

Уже есть:

- `docker-compose.prod.yml` — Caddy (HTTPS), без проброса портов frontend/backend наружу.
- `deploy/Caddyfile` — обратный прокси на frontend:80 (домен из переменной `DOMAIN`).
- `.env.production.example` — шаблон `.env` для сервера.
- `docker-compose.staging.yml` и `.env.staging.example` — для staging-окружения (см. раздел Staging ниже).

## 4. Деплой на сервере

Есть два режима: **сборка на сервере** (классический) и **pull готовых образов из CI** (быстрее, рекомендуется).

### 4a. Деплой из CI-образов (рекомендуется)

Workflow `.github/workflows/build.yml` при push в `main` или `dev` собирает образы и пушит их в GHCR. Сервер только тянет образы — без сборки.

**Настройка:**

1. В репозитории: Settings → Actions → General → Workflow permissions: Read and write.
2. В Settings → Secrets and variables → Actions добавьте переменные (Variables):
   - `EXPO_PUBLIC_API_URL` — для main (по умолчанию https://tsspro.tech)
   - `EXPO_PUBLIC_API_URL_DEV` — для dev (по умолчанию https://dev.tsspro.tech)
   - `EXPO_PUBLIC_SENTRY_DSN` — опционально
3. На сервере залогиньтесь в GHCR (для приватных образов):
   ```bash
   echo $GITHUB_TOKEN | docker login ghcr.io -u <github-username> --password-stdin
   ```
   Токен с правом `read:packages`. Сохраните логин в скрипте или cron при необходимости.

**Деплой:**

```bash
make deploy-no-push USE_CI_IMAGES=1 CI_REGISTRY_OWNER=<owner> CI_IMAGE_TAG=latest
```

`<owner>` — владелец репозитория (org или user). `CI_IMAGE_TAG` — `latest`, short sha или версия.

### 4b. Деплой со сборкой на сервере

Для ускорения сборки используется кэш Docker (слои) и кэш Metro/Expo (BuildKit cache mount в frontend). Сборку выполняйте **без** `--no-cache`, если не менялись зависимости — тогда пересоберутся только изменённые слои.

```bash
git clone <url> smart_trainer
cd smart_trainer
cp .env.production.example .env
# Отредактировать .env: POSTGRES_PASSWORD, SECRET_KEY, ENCRYPTION_KEY,
# APP_ENV=production, GOOGLE_GEMINI_API_KEY,
# DEBUG=false, DOMAIN=<ваш-домен>. Опционально: JWT_PRIVATE_KEY и JWT_PUBLIC_KEY для RS256 (см. раздел про JWT ниже).
# Для HTTPS включите HSTS: ENABLE_HSTS=true (добавляет заголовок Strict-Transport-Security в ответы API).
# Для Sentry: SENTRY_DSN и SENTRY_ENVIRONMENT (см. раздел Sentry ниже); фронт при сборке возьмёт DSN из SENTRY_DSN, если EXPO_PUBLIC_SENTRY_DSN не задан.
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend alembic upgrade head
```

Использование **`build --no-cache`**: только при смене `package.json`/`package-lock.json` или для принудительной полной пересборки (отладка, подозрение на испорченный кэш). Сборка займёт заметно больше времени.

## 5. Проверка

Открыть `https://<ваш-домен>`, проверить логин и API.

### Если 502 Bad Gateway на /api/v1/...

Caddy отдаёт трафик во frontend (nginx), nginx проксирует `/api/` на `backend:8000`. 502 значит, что backend не отвечает.

На сервере выполнить:

```bash
cd /root/smart_trainer  # или ваш путь к репозиторию
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend --tail 100
```

- Если контейнер **backend** в состоянии **Exited** — смотреть логи выше, типично: ошибка БД (DATABASE_URL), отсутствие переменной в `.env`, краш при старте.
- Если **backend** в состоянии **Up** — проверить изнутри frontend, доступен ли backend:  
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec frontend wget -qO- http://backend:8000/health`  
  Должен вернуть ответ от backend. Если нет — сеть или backend не слушает порт 8000.
- Перезапуск backend:  
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend`  
  После изменений в `.env`:  
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate backend`

### Sentry (отслеживание ошибок)

- **Backend:** при заданных в `.env` переменных `SENTRY_DSN` и `SENTRY_ENVIRONMENT` все необработанные исключения и вызовы `sentry_sdk.capture_exception` отправляются в Sentry.
- **Frontend:** при сборке в образ передаётся DSN через build-arg: если в `.env` задан `EXPO_PUBLIC_SENTRY_DSN`, используется он; иначе — значение `SENTRY_DSN`. После деплоя с обновлённым DSN нужно пересобрать фронт: `docker compose -f docker-compose.yml -f docker-compose.prod.yml build frontend && ... up -d`.
- Проверка на сервере: в `.env` должны быть `SENTRY_DSN=` и `SENTRY_ENVIRONMENT=production` (значения из проекта в sentry.io). Ошибки при редактировании еды и другие исключения на клиенте теперь отправляются во фронтовый проект с тегом `feature: edit_food`.

## 6. Prometheus и Grafana (мониторинг)

В production compose поднимаются Prometheus и Grafana. Метрики backend доступны по `GET /metrics`.

- **Prometheus** скрапит `backend:8000/metrics` каждые 15s (конфиг: `deploy/prometheus.yml`).
- **Grafana** доступна на `http://127.0.0.1:3000` (только с хоста; снаружи не открыта). Пароль админа: переменная `GRAFANA_PASSWORD` в `.env` (по умолчанию `admin`).

**Первый вход в Grafana:** откройте порт через SSH-туннель: `ssh -L 3000:127.0.0.1:3000 user@<production-server>` (host из `DEPLOY_HOST`), затем в браузере `http://localhost:3000`. Логин `admin`, пароль из `GRAFANA_PASSWORD`. Добавьте Data source → Prometheus, URL: `http://prometheus:9090`, Save & Test.

## 7. Обновления

### Деплой из CI (рекомендуется)

После push в `main` workflow `.github/workflows/build.yml` собирает образы и пушит в GHCR. Деплой — pull и stack deploy:

```bash
make deploy-no-push USE_CI_IMAGES=1 CI_REGISTRY_OWNER=<owner> CI_IMAGE_TAG=latest
```

Для dev: `make deploy-dev-no-push USE_CI_IMAGES=1 CI_REGISTRY_OWNER=<owner> CI_IMAGE_TAG=latest`.

### Деплой со сборкой на сервере

Вручную (обычное обновление кода — **без** `--no-cache`, чтобы использовать кэш слоёв и кэш Metro/Expo):

```bash
cd smart_trainer
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend alembic upgrade head  # при необходимости
```

- Для **рутинного деплоя** используйте `build` без флагов. Кэш npm (слой установки зависимостей) и кэш Metro/Expo (BuildKit cache mount в frontend Dockerfile) ускорят повторные сборки. BuildKit включён по умолчанию в актуальных версиях Docker.
- **`build --no-cache`** — только если менялись `package.json`/`package-lock.json` или нужна полная пересборка.
- **Сборка только одного сервиса** (ускоряет деплой): `make deploy-no-push BUILD_SERVICES=backend` или `BUILD_SERVICES=frontend`.

### Версионирование образов и rollback

При каждом деплое образы backend и frontend помечаются тегом версии: `git describe --tags --always` (например, `v0.1.0` или короткий хеш коммита). Имена образов: `st2-backend:<version>`, `st2-frontend:<version>`.

**Rollback при деплое из CI:** указать предыдущий тег:
```bash
make deploy-no-push USE_CI_IMAGES=1 CI_REGISTRY_OWNER=<owner> CI_IMAGE_TAG=<previous-sha-or-version>
```

**Rollback при сборке на сервере:** на сервере выполнить:
```bash
cd /root/smart_trainer
git log -1 --format=%h   # текущий коммит
git checkout <previous-commit-hash>
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend alembic upgrade head || true
```

## 8. JWT RS256 (опционально, для multi-instance / rollback)

Для нескольких реплик API за load balancer рекомендуется RS256: реплики проверяют токены по публичному ключу без доступа к секрету подписи.

**Генерация ключей:**
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

В `.env` задать `JWT_PRIVATE_KEY` и `JWT_PUBLIC_KEY` — содержимое PEM-файлов. В одной строке переносы заменить на `\n`. В production при задании одного ключа обязательно задать оба (иначе старт упадёт с ошибкой).

**Ротация ключей:** выдать новые ключи, задеплоить backend с новыми `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`. Старые выданные access-токены перестанут валидироваться; пользователям нужно перелогиниться или обновить токен через refresh. Refresh-токены хранятся в БД и не зависят от алгоритма JWT.

**Rollback:** при откате деплоя на предыдущую версию образа сохраняйте те же ключи в `.env` (или откатывайте `.env` вместе с образом), иначе старые токены не будут приниматься.

## 9. Staging

Отдельный сервер или тот же сервер с другим каталогом/namespace для тестирования перед production.

1. Клонировать репозиторий в отдельный каталог (например `/root/smart_trainer_staging`) или использовать другой compose project.
2. Скопировать `.env.staging.example` в `.env`, задать `DOMAIN=staging.yourdomain.com`, отдельные `POSTGRES_PASSWORD` и `POSTGRES_DB` (например `smart_trainer_staging`), чтобы не смешивать с production.
3. DNS: A-запись для `staging.yourdomain.com` на IP сервера (или тот же сервер с другим виртуальным хостом в Caddy).
4. Запуск:
   ```bash
   cd smart_trainer
   cp .env.staging.example .env
   # редактировать .env: DOMAIN, POSTGRES_*, SECRET_KEY, ENCRYPTION_KEY
   docker compose -f docker-compose.yml -f docker-compose.staging.yml -f docker-compose.prod.yml build
   docker compose -f docker-compose.yml -f docker-compose.staging.yml -f docker-compose.prod.yml up -d
   docker compose -f docker-compose.yml -f docker-compose.staging.yml -f docker-compose.prod.yml exec backend alembic upgrade head
   ```
   Если Caddy один на сервере, добавляют в `Caddyfile` второй виртуальный хост для `staging.yourdomain.com`, проксирующий на staging-frontend.
5. Различия с production: `APP_ENV=staging`, `DEBUG=true` по умолчанию, отдельная БД и секреты.

## 10. Бэкапы PostgreSQL

Сервис `backup` в `docker-compose.prod.yml` раз в сутки делает `pg_dump`, сжимает дамп и загружает его в S3-совместимое хранилище (Selectel, AWS или другой S3 API). Потеря базы без бэкапов недопустима — в ней хранятся логи питания и тренировок.

### Настройка

В `.env` на сервере задайте переменные (см. `.env.production.example`):

- **Обязательно:** `S3_BACKUP_BUCKET`, `S3_BACKUP_ACCESS_KEY`, `S3_BACKUP_SECRET_KEY`.
- **Selectel:** укажите `S3_BACKUP_ENDPOINT=https://s3.selcdn.ru` (или ваш endpoint).
- **AWS:** переменную `S3_BACKUP_ENDPOINT` не задавайте или оставьте пустой.
- По желанию: `S3_BACKUP_PREFIX=backups/postgres/`, `BACKUP_CRON_SCHEDULE=0 3 * * *` (по умолчанию 03:00 UTC), `BACKUP_RETENTION_DAYS=30` (удаление старых дампов в S3; 0 = не удалять).

После этого при деплое поднимается контейнер `backup`; он подключается к `postgres` по внутренней сети и по расписанию выполняет дамп и загрузку в S3.

### Проверка, что бэкапы идут

1. Логи контейнера: `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backup` — должны быть строки вида «Starting backup…», «Backup completed».
2. В бакете S3 должны появляться объекты с именами вида `backups/postgres/smart_trainer_YYYYMMDD_HHMM.dump.gz`.

### Восстановление из бэкапа

Скрипт `deploy/restore-from-s3.sh` скачивает выбранный дамп из S3 и восстанавливает его в работающий контейнер PostgreSQL.

**Внимание:** восстановление перезаписывает текущую БД (`--clean --if-exists`). Остановите backend или предупредите пользователей о краткой недоступности.

**Безопасность:** скрипт требует интерактивный запуск (нельзя передавать `echo y |`). Перед restore создаётся локальный бэкап текущей БД в `/tmp/smart_trainer_pre_restore_YYYYMMDD_HHMMSS.dump.gz`. При ошибке restore этот файл можно использовать для отката.

1. На сервере в каталоге проекта: `cd /root/smart_trainer` (или ваш путь).
2. Запуск (интерактивно):
   ```bash
   chmod +x deploy/restore-from-s3.sh
   ./deploy/restore-from-s3.sh latest
   ```
   Вместо `latest` можно указать полный ключ объекта в S3, например `backups/postgres/smart_trainer_20250301_0300.dump.gz`.
3. Скрипт загружает `.env`, скачивает дамп, запрашивает подтверждение (нужно ввести `yes`), создаёт pre-restore backup и выполняет `pg_restore`. Для проверки без восстановления: `./deploy/restore-from-s3.sh latest --dry-run`.
4. После восстановления проверьте данные и при необходимости перезапустите backend: `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend`.

На серверах с `docker stack deploy` (prod, dev) скрипт автоматически определяет контейнер `st2_postgres` и выполняет `docker cp` / `docker exec` вместо `docker compose`.

### Восстановление базы на dev из S3 (продовые дампы)

**Важно:** обычный `make deploy-dev` и `make deploy-dev-no-push` **не трогают** dev БД. Текущие данные сохраняются. Restore из S3 — только ручное действие.

Чтобы поднять на dev-сервере копию продовой базы (без ручного ввода данных):

1. **В `.env` на dev-сервере** добавьте переменные доступа к тому же S3-бакету, куда прод пишет дампы (достаточно прав на чтение):
   - `S3_BACKUP_BUCKET` — бакет с бэкапами
   - `S3_BACKUP_ACCESS_KEY`, `S3_BACKUP_SECRET_KEY` — ключи (можно те же, что на проде, или отдельные с доступом только на чтение)
   - При использовании S3-совместимого хранилища: `S3_BACKUP_ENDPOINT`
   - При отличном префиксе: `S3_BACKUP_PREFIX` (по умолчанию `backups/postgres/`)

2. **На dev-сервере** должен быть установлен AWS CLI (`aws s3`). Если нет: `apt-get update && apt-get install -y awscli` (или аналог для вашего дистрибутива).

3. **Запуск восстановления (ручной, destructive):**
   - С локальной машины (интерактивно, с TTY): `make restore-dev-from-s3` — SSH на dev, останавливает backend, запускает скрипт, запрашивает подтверждение и создаёт pre-restore backup.
   - Или по SSH на dev: `cd /root/smart_trainer && docker service scale st2_backend=0 && sleep 5 && ./deploy/restore-from-s3.sh latest && docker service scale st2_backend=1`

Скрипт создаёт бэкап текущей dev БД в `/tmp/smart_trainer_pre_restore_*.dump.gz` перед restore. Требует ввести `yes` для подтверждения. Нельзя вызывать через pipe (`echo y |`).

После restore данные на dev будут копией прода. Не используйте dev для отладки под реальными пользователями без обезличивания, если это требуется политикой.

### Рекомендация

Раз в квартал проверяйте восстановление: выполните `restore-from-s3.sh latest --dry-run`, затем при необходимости — полное восстановление в тестовую БД или на staging, чтобы убедиться, что дампы не битые и процедура отрабатывает.
