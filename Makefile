# IP компьютера в Wi‑Fi: авто (en0 на Mac, иначе .wifi_ip или 192.168.1.157). Переопределить: make use-wifi WIFI_IP=192.168.1.200
WIFI_IP ?= $(shell (ipconfig getifaddr en0 2>/dev/null) || (hostname -I 2>/dev/null | awk '{print $$1}') || (cat .wifi_ip 2>/dev/null) || echo "192.168.1.157")

# Деплой на сервер: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH. Пример: make deploy DEPLOY_USER=ubuntu
DEPLOY_HOST ?= 167.71.74.220
DEPLOY_USER ?= root
DEPLOY_PATH ?= /root/smart_trainer

# Dev server (dev.tsspro.tech)
DEV_DEPLOY_HOST ?= 209.38.17.171
DEV_DEPLOY_USER ?= root
DEV_DEPLOY_PATH ?= /root/smart_trainer
REPO_URL ?= $(shell git remote get-url origin 2>/dev/null || true)

# Stack deploy compose files: add low-resources override for dev (1 vCPU) to avoid CPU overload
ifeq ($(DEPLOY_HOST),$(DEV_DEPLOY_HOST))
STACK_DEPLOY_FILES = -c docker-compose.yml -c docker-compose.prod.yml -c docker-compose.low-resources.yml
else
STACK_DEPLOY_FILES = -c docker-compose.yml -c docker-compose.prod.yml
endif

# Версия для образов: из Git тега (v0.1.0-alpha.1) или коммита. В проде — только протегированные сборки.
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo "0.1.0-alpha.1")

.PHONY: build up down run logs logs-backend logs-frontend logs-db ps migrate shell-backend use-localhost use-wifi set-wifi test build-prod up-prod migrate-prod build-prod-tagged deploy deploy-no-push bootstrap-dev ensure-dev-server deploy-dev deploy-dev-no-push dev-server-set-node-memory restore-dev-from-s3

build:
	docker compose build

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
	@sleep 20
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
# Сборка prod-образов с тегом версии (SemVer). В проде крутятся только протегированные сборки. См. docs/VERSIONING.md
build-prod-tagged:
	$(COMPOSE_PROD) build
	docker tag st2-backend:latest st2-backend:$(VERSION)
	docker tag st2-frontend:latest st2-frontend:$(VERSION)
	@echo "Образы помечены версией: st2-backend:$(VERSION), st2-frontend:$(VERSION)"
up-prod:
	$(COMPOSE_PROD) up -d
migrate-prod:
	$(COMPOSE_PROD) exec -T backend alembic upgrade head

# Для dev-сервера: какую ветку катить (текущая). Для prod не задаём — на сервере остаётся main.
DEPLOY_BRANCH ?=

# Деплой на production: пуш main, на сервере git pull (main), build, stack deploy, миграции.
# Переопределить: make deploy DEPLOY_HOST=1.2.3.4 DEPLOY_PATH=/home/app/smart_trainer
deploy:
	git push origin main
	$(MAKE) deploy-no-push

# Только действия на сервере. Если задан DEPLOY_BRANCH — fetch + reset --hard (локальные правки на сервере сбрасываются); иначе git pull (main).
# Сборка образов, docker stack deploy (Swarm), alembic upgrade head.
deploy-no-push:
	@BRANCH_CMD=''; \
	if [ -n '$(DEPLOY_BRANCH)' ]; then \
		BRANCH_CMD='git fetch origin && git checkout "$(DEPLOY_BRANCH)" && git reset --hard origin/$(DEPLOY_BRANCH)'; \
	else \
		BRANCH_CMD='git pull'; \
	fi; \
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "cd $(DEPLOY_PATH) && $$BRANCH_CMD && $(COMPOSE_PROD) build && set -a && . ./.env && set +a && docker stack deploy $(STACK_DEPLOY_FILES) st2 && sleep 25 && export DATABASE_URL=\"postgresql+asyncpg://\$${POSTGRES_USER:-smart_trainer}:\$${POSTGRES_PASSWORD}@st2_postgres:5432/\$${POSTGRES_DB:-smart_trainer}\" && docker run --rm --network st2_backend-db -e DATABASE_URL=\"\$$DATABASE_URL\" st2-backend:latest alembic upgrade head"
	@if [ -n '$(DEPLOY_BRANCH)' ]; then echo "Деплой завершён: https://dev.tsspro.tech"; else echo "Деплой завершён: https://tsspro.tech"; fi

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
deploy-dev: ensure-dev-server
	git push origin $(shell git branch --show-current)
	$(MAKE) deploy-no-push DEPLOY_HOST=$(DEV_DEPLOY_HOST) DEPLOY_USER=$(DEV_DEPLOY_USER) DEPLOY_PATH=$(DEV_DEPLOY_PATH) DEPLOY_BRANCH=$(shell git branch --show-current)

# Deploy to dev server without git push (на сервере всё равно будет checkout текущей ветки и pull).
deploy-dev-no-push: ensure-dev-server
	$(MAKE) deploy-no-push DEPLOY_HOST=$(DEV_DEPLOY_HOST) DEPLOY_USER=$(DEV_DEPLOY_USER) DEPLOY_PATH=$(DEV_DEPLOY_PATH) DEPLOY_BRANCH=$(shell git branch --show-current)

# Add or update NODE_MEMORY_MB=768 in .env on dev server (for 1GB RAM). Run once, then make deploy-dev.
dev-server-set-node-memory:
	ssh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST) "grep -q '^NODE_MEMORY_MB=' $(DEV_DEPLOY_PATH)/.env 2>/dev/null && sed -i 's/^NODE_MEMORY_MB=.*/NODE_MEMORY_MB=768/' $(DEV_DEPLOY_PATH)/.env || echo 'NODE_MEMORY_MB=768' >> $(DEV_DEPLOY_PATH)/.env; echo 'NODE_MEMORY_MB=768 set in .env on dev server.'"

# Restore dev DB from prod backups in S3. Requires S3_BACKUP_* in .env on dev and aws cli on dev. Runs restore-from-s3.sh on dev (stack postgres).
restore-dev-from-s3:
	ssh $(DEV_DEPLOY_USER)@$(DEV_DEPLOY_HOST) "cd $(DEV_DEPLOY_PATH) && echo y | ./deploy/restore-from-s3.sh latest"

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
