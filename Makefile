# IP компьютера в Wi‑Fi: авто (en0 на Mac, иначе .wifi_ip или 192.168.1.157). Переопределить: make use-wifi WIFI_IP=192.168.1.200
WIFI_IP ?= $(shell (ipconfig getifaddr en0 2>/dev/null) || (hostname -I 2>/dev/null | awk '{print $$1}') || (cat .wifi_ip 2>/dev/null) || echo "192.168.1.157")

# Deploy config: copy deploy.env.example to deploy.env and set hosts. deploy.env is gitignored.
-include deploy.env

# Деплой на сервер: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH. Пример: make deploy DEPLOY_USER=ubuntu
DEPLOY_USER ?= root
DEPLOY_PATH ?= /root/smart_trainer

# Dev server (dev.tsspro.tech)
DEV_DEPLOY_USER ?= root
DEV_DEPLOY_PATH ?= /root/smart_trainer
REPO_URL ?= $(shell git remote get-url origin 2>/dev/null || true)

# Stack deploy compose files: 2gb override for prod, low-resources for dev (by DEPLOY_TARGET)
ifeq ($(DEPLOY_TARGET),prod)
STACK_DEPLOY_FILES = -c docker-compose.yml -c docker-compose.prod.yml -c docker-compose.2gb.yml
else ifeq ($(DEPLOY_TARGET),dev)
STACK_DEPLOY_FILES = -c docker-compose.yml -c docker-compose.prod.yml -c docker-compose.low-resources.yml
else
STACK_DEPLOY_FILES = -c docker-compose.yml -c docker-compose.prod.yml
endif

# Версия для образов: из Git тега (v0.1.0-alpha.1) или коммита. В проде — только протегированные сборки.
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo "0.1.0-alpha.1")

.PHONY: build build-backend build-frontend build-landing up down run logs logs-backend logs-frontend logs-db ps migrate shell-backend use-localhost use-wifi set-wifi test build-prod build-prod-backend build-prod-frontend up-prod migrate-prod build-prod-tagged deploy deploy-no-push deploy-backend deploy-backend-no-push deploy-frontend deploy-frontend-no-push bootstrap-dev ensure-dev-server deploy-dev deploy-dev-no-push deploy-dev-backend-no-push deploy-dev-frontend-no-push dev-server-set-node-memory restore-dev-from-s3

build:
	docker compose build

build-backend:
	docker compose build backend

build-frontend:
	docker compose build frontend

build-landing:
	docker compose build landing

up:
	docker compose up -d

down:
	docker compose down --remove-orphans

# Полный цикл: остановить контейнеры и тома, пересобрать, запустить, миграции (проект st2 — обходит залипший container ID в старом проекте smart_trainer)
run:
	docker compose down -v --remove-orphans
	docker compose build
	docker compose up -d
	@echo "Ожидание запуска backend..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do curl -sf http://localhost:8000/health >/dev/null 2>&1 && break; sleep 2; done
	docker compose exec backend alembic upgrade head
	@echo "Готово. Фронт: http://localhost"

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-frontend:
	docker compose logs -f frontend

logs-db:
	docker compose logs -f postgres

ps:
	docker compose ps

migrate:
	docker compose exec backend alembic upgrade head

# Production (на сервере после git pull)
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml
build-prod:
	$(COMPOSE_PROD) build

build-prod-backend:
	$(COMPOSE_PROD) build backend

build-prod-frontend:
	$(COMPOSE_PROD) build frontend
# Сборка prod-образов с тегом версии (SemVer). В проде крутятся только протегированные сборки. См. docs/VERSIONING.md
build-prod-tagged:
	$(COMPOSE_PROD) build
	docker tag st2-backend:latest st2-backend:$(VERSION)
	docker tag st2-frontend:latest st2-frontend:$(VERSION)
	docker tag st2-landing:latest st2-landing:$(VERSION)
	@echo "Образы помечены версией: st2-backend:$(VERSION), st2-frontend:$(VERSION), st2-landing:$(VERSION)"
up-prod:
	$(COMPOSE_PROD) up -d
migrate-prod:
	$(COMPOSE_PROD) exec -T backend alembic upgrade head

# Выдать права суперпользователя на prod. EMAIL обязателен. Пример: make create-superuser EMAIL=santex85@gmail.com
create-superuser:
	@if [ -z "$(EMAIL)" ]; then echo "Usage: make create-superuser EMAIL=user@example.com"; exit 1; fi
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "cd $(DEPLOY_PATH) && set -a && . ./.env && set +a && export DATABASE_URL=\"postgresql+asyncpg://\$${POSTGRES_USER:-tssproai}:\$${POSTGRES_PASSWORD}@st2_postgres:5432/\$${POSTGRES_DB:-tssproai}\" && docker run --rm --network st2_backend-db -v $(DEPLOY_PATH)/backend/scripts:/app/scripts:ro -e DATABASE_URL=\"\$$DATABASE_URL\" st2-backend:latest python scripts/create_superuser.py $(EMAIL)"

# Для dev-сервера: какую ветку катить (текущая). Для prod не задаём — на сервере остаётся main.
DEPLOY_BRANCH ?=

# Сборка только указанных сервисов при деплое. Пусто = все. Пример: make deploy-no-push BUILD_SERVICES=backend
BUILD_SERVICES ?=

# Деплой из CI-образов (без сборки на сервере). Требует: USE_CI_IMAGES=1, CI_REGISTRY_OWNER=<ghcr-owner>, CI_IMAGE_TAG=latest или short-sha.
USE_CI_IMAGES ?=
CI_REGISTRY_OWNER ?=
CI_IMAGE_TAG ?= latest

# Деплой на production: пуш main, сборка на сервере, stack deploy.
# Переопределить: make deploy DEPLOY_HOST=1.2.3.4 DEPLOY_PATH=/home/app/smart_trainer
deploy:
	git push origin main
	$(MAKE) deploy-no-push DEPLOY_TARGET=prod

# Только действия на сервере. fetch + reset --hard (локальные правки на сервере сбрасываются).
# Prod: main; Dev: DEPLOY_BRANCH (текущая ветка).
# BUILD_SERVICES=backend или frontend — собрать только указанный сервис (ускоряет деплой при изменениях только в одном).
# USE_CI_IMAGES=1 — pull вместо build (образы из CI, см. .github/workflows/build.yml).
deploy-no-push:
	@if [ -z '$(DEPLOY_BRANCH)' ] && [ -z '$(DEPLOY_HOST)' ]; then echo "Error: Set DEPLOY_HOST (e.g. in deploy.env). Copy deploy.env.example to deploy.env."; exit 1; fi; \
	if [ -n '$(DEPLOY_BRANCH)' ] && [ -z '$(DEV_DEPLOY_HOST)' ]; then echo "Error: Set DEV_DEPLOY_HOST (e.g. in deploy.env). Copy deploy.env.example to deploy.env."; exit 1; fi; \
	BRANCH_CMD=''; \
	if [ -n '$(DEPLOY_BRANCH)' ]; then \
		BRANCH_CMD='git fetch origin && git checkout "$(DEPLOY_BRANCH)" && git reset --hard origin/$(DEPLOY_BRANCH)'; \
	else \
		BRANCH_CMD='git fetch origin && git checkout main && git reset --hard origin/main'; \
	fi; \
	if [ -n '$(USE_CI_IMAGES)' ] && [ -n '$(CI_REGISTRY_OWNER)' ]; then \
		BUILD_CMD="docker pull ghcr.io/$(CI_REGISTRY_OWNER)/tssproai-backend:$(CI_IMAGE_TAG) && docker tag ghcr.io/$(CI_REGISTRY_OWNER)/tssproai-backend:$(CI_IMAGE_TAG) st2-backend:latest && docker pull ghcr.io/$(CI_REGISTRY_OWNER)/tssproai-frontend:$(CI_IMAGE_TAG) && docker tag ghcr.io/$(CI_REGISTRY_OWNER)/tssproai-frontend:$(CI_IMAGE_TAG) st2-frontend:latest && $(COMPOSE_PROD) build landing"; \
	else \
		BUILD_CMD="$(COMPOSE_PROD) build --no-cache"; [ -n '$(BUILD_SERVICES)' ] && BUILD_CMD="$(COMPOSE_PROD) build --no-cache $(BUILD_SERVICES)"; \
	fi; \
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "cd $(DEPLOY_PATH) && $$BRANCH_CMD && $$BUILD_CMD && set -a && . ./.env && set +a && docker stack deploy $(STACK_DEPLOY_FILES) st2 && for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do docker run --rm --network st2_backend-db -e PGPASSWORD=\"\$$POSTGRES_PASSWORD\" postgres:16-alpine pg_isready -h st2_postgres -U \"\$${POSTGRES_USER:-tssproai}\" -d \"\$${POSTGRES_DB:-tssproai}\" 2>/dev/null && break; sleep 2; done && export DATABASE_URL=\"postgresql+asyncpg://\$${POSTGRES_USER:-tssproai}:\$${POSTGRES_PASSWORD}@st2_postgres:5432/\$${POSTGRES_DB:-tssproai}\" && docker run --rm --network st2_backend-db -e DATABASE_URL=\"\$$DATABASE_URL\" st2-backend:latest alembic upgrade head && ( [ -z '$(BUILD_SERVICES)' ] || echo '$(BUILD_SERVICES)' | grep -qw landing ) && docker service update --force st2_landing || true && ( [ -z '$(BUILD_SERVICES)' ] || echo '$(BUILD_SERVICES)' | grep -qw frontend ) && docker service update --force st2_frontend || true && ( [ -z '$(BUILD_SERVICES)' ] || echo '$(BUILD_SERVICES)' | grep -qw backend ) && docker service update --force st2_backend || true"
	@if [ -n '$(DEPLOY_BRANCH)' ]; then echo "Деплой завершён: https://dev.tsspro.tech (landing), https://dev.app.tsspro.tech (app)"; else echo "Деплой завершён: https://tsspro.tech (landing), https://app.tsspro.tech (app)"; fi

# Собрать и задеплоить только backend (без пересборки frontend).
deploy-backend-no-push:
	$(MAKE) deploy-no-push BUILD_SERVICES=backend

# Собрать и задеплоить только frontend (без пересборки backend).
deploy-frontend-no-push:
	$(MAKE) deploy-no-push BUILD_SERVICES=frontend

# Prod: пуш main и деплой только backend.
deploy-backend:
	git push origin main
	$(MAKE) deploy-no-push DEPLOY_TARGET=prod BUILD_SERVICES=backend

# Prod: пуш main и деплой только frontend.
deploy-frontend:
	git push origin main
	$(MAKE) deploy-no-push DEPLOY_TARGET=prod BUILD_SERVICES=frontend

# Однократно: снять стек и удалить overlay-сети, чтобы при следующем deploy они создались с attachable: true (для docker run миграций).
# После выполнения запустите: make deploy
deploy-fix-networks:
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "cd $(DEPLOY_PATH) && docker stack rm st2 && echo 'Ждём снятия сервисов...' && sleep 25 && docker network rm st2_backend-db st2_frontend-backend 2>/dev/null || true"
	@echo "Сети пересозданы. Запустите: make deploy"

# Dev server: one-time bootstrap (Docker + Swarm). Then clone repo, create .env from .env.development.example, and make deploy-dev.
bootstrap-dev:
	scp deploy/bootstrap-dev.sh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST):/tmp/bootstrap-dev.sh
	ssh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST) "DEPLOY_PATH=$(DEV_DEPLOY_PATH) ADVERTISE_ADDR=$(DEV_DEPLOY_HOST) bash /tmp/bootstrap-dev.sh"

# Ensure dev server is ready: bootstrap, clone repo if missing, create .env from example if missing (then exit 1 so user fills secrets).
ensure-dev-server:
	@$(MAKE) bootstrap-dev
	@ssh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST) "export REPO_URL='$(REPO_URL)' DEPLOY_PATH='$(DEV_DEPLOY_PATH)'; \
		if [ -z \"\$$REPO_URL\" ]; then echo 'REPO_URL empty (no git remote origin?). Set REPO_URL= or clone repo on server.'; exit 1; fi; \
		if [ ! -d \"\$$DEPLOY_PATH/.git\" ]; then echo 'Cloning repo into' \$$DEPLOY_PATH '...'; git clone \"\$$REPO_URL\" \"\$$DEPLOY_PATH\"; fi; \
		if [ ! -f \"\$$DEPLOY_PATH/.env\" ]; then \
			if [ -f \"\$$DEPLOY_PATH/.env.development.example\" ]; then cp \"\$$DEPLOY_PATH/.env.development.example\" \"\$$DEPLOY_PATH/.env\"; \
			else cp \"\$$DEPLOY_PATH/.env.production.example\" \"\$$DEPLOY_PATH/.env\"; fi; \
			echo ''; echo 'Created .env from example. Fill in secrets on the server then run make deploy-dev again:'; \
			echo '  ssh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST)'; echo \"  nano \$$DEPLOY_PATH/.env\"; echo ''; exit 1; \
		fi"

# Deploy to dev server (dev.tsspro.tech): пуш текущей ветки (обычно dev), на сервере checkout этой ветки и deploy.
# Dev БД сохраняется; restore из S3 — только вручную: make restore-dev-from-s3
deploy-dev: ensure-dev-server
	git push origin $(shell git branch --show-current)
	$(MAKE) deploy-no-push DEPLOY_TARGET=dev DEPLOY_HOST=$(DEV_DEPLOY_HOST) DEPLOY_USER=$(DEV_DEPLOY_USER) DEPLOY_PATH=$(DEV_DEPLOY_PATH) DEPLOY_BRANCH=$(shell git branch --show-current)

# Deploy to dev server without git push (на сервере всё равно будет checkout текущей ветки и pull).
deploy-dev-no-push: ensure-dev-server
	$(MAKE) deploy-no-push DEPLOY_TARGET=dev DEPLOY_HOST=$(DEV_DEPLOY_HOST) DEPLOY_USER=$(DEV_DEPLOY_USER) DEPLOY_PATH=$(DEV_DEPLOY_PATH) DEPLOY_BRANCH=$(shell git branch --show-current)

# Dev: деплой только backend. Пример: make deploy-dev-backend-no-push
deploy-dev-backend-no-push: ensure-dev-server
	$(MAKE) deploy-no-push DEPLOY_TARGET=dev DEPLOY_HOST=$(DEV_DEPLOY_HOST) DEPLOY_USER=$(DEV_DEPLOY_USER) DEPLOY_PATH=$(DEV_DEPLOY_PATH) DEPLOY_BRANCH=$(shell git branch --show-current) BUILD_SERVICES=backend

# Dev: деплой только frontend.
deploy-dev-frontend-no-push: ensure-dev-server
	$(MAKE) deploy-no-push DEPLOY_TARGET=dev DEPLOY_HOST=$(DEV_DEPLOY_HOST) DEPLOY_USER=$(DEV_DEPLOY_USER) DEPLOY_PATH=$(DEV_DEPLOY_PATH) DEPLOY_BRANCH=$(shell git branch --show-current) BUILD_SERVICES=frontend

# Add or update NODE_MEMORY_MB=768 in .env on dev server (for 1GB RAM). Run once, then make deploy-dev.
dev-server-set-node-memory:
	ssh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST) "grep -q '^NODE_MEMORY_MB=' $(DEV_DEPLOY_PATH)/.env 2>/dev/null && sed -i 's/^NODE_MEMORY_MB=.*/NODE_MEMORY_MB=768/' $(DEV_DEPLOY_PATH)/.env || echo 'NODE_MEMORY_MB=768' >> $(DEV_DEPLOY_PATH)/.env; echo 'NODE_MEMORY_MB=768 set in .env on dev server.'"

# Restore dev DB from prod backups in S3. MANUAL ONLY — destructive. Requires S3_BACKUP_* in .env on dev and aws cli.
# Script creates pre-restore backup and requires interactive confirmation. Use: make restore-dev-from-s3
restore-dev-from-s3:
	@echo "WARNING: restore-dev-from-s3 overwrites dev DB. Script will create backup first and prompt for confirmation."
	ssh -t $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST) "cd $(DEV_DEPLOY_PATH) && set -e; trap 'docker service scale st2_backend=1 >/dev/null 2>&1 || true' EXIT; docker service scale st2_backend=0; sleep 5; ./deploy/restore-from-s3.sh latest"

shell-backend:
	docker compose exec backend sh

# Переключить конфиг на localhost (браузер на этом же компе)
use-localhost:
	@echo "EXPO_PUBLIC_API_URL=http://localhost:8000" > frontend/.env
	@echo "Готово: API = localhost:8000"

# Переключить конфиг на Wi‑Fi (доступ с телефона). IP авто (en0 / hostname -I / .wifi_ip) или: make use-wifi WIFI_IP=192.168.1.200
use-wifi:
	@echo "IP: $(WIFI_IP)"
	@echo "EXPO_PUBLIC_API_URL=http://$(WIFI_IP):8000" > frontend/.env
	@echo "Готово: API = $(WIFI_IP):8000 (открой с телефона http://$(WIFI_IP))"

# Сохранить IP Wi‑Fi и переключить конфиг. Пример: make set-wifi IP=192.168.1.157
set-wifi:
	@if [ -z "$(IP)" ]; then echo "Укажи IP: make set-wifi IP=192.168.1.157"; exit 1; fi
	@echo "$(IP)" > .wifi_ip
	@$(MAKE) use-wifi WIFI_IP=$(IP)

# Backend unit tests (requires: pip install -r backend/requirements.txt pytest pytest-asyncio)
test:
	cd backend && PYTHONPATH=. python3 -m pytest tests/ -v
