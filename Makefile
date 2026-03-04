# IP компьютера в Wi‑Fi: авто (en0 на Mac, иначе .wifi_ip или 192.168.1.157). Переопределить: make use-wifi WIFI_IP=192.168.1.200
WIFI_IP ?= $(shell (ipconfig getifaddr en0 2>/dev/null) || (hostname -I 2>/dev/null | awk '{print $$1}') || (cat .wifi_ip 2>/dev/null) || echo "192.168.1.157")

# Деплой на сервер: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH. Пример: make deploy DEPLOY_USER=ubuntu
DEPLOY_HOST ?= 167.71.74.220
DEPLOY_USER ?= root
DEPLOY_PATH ?= /root/smart_trainer

# Версия для образов: из Git тега (v0.1.0-alpha.1) или коммита. В проде — только протегированные сборки.
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo "0.1.0-alpha.1")

.PHONY: build up down run logs logs-backend logs-frontend logs-db ps migrate shell-backend use-localhost use-wifi set-wifi test build-prod up-prod migrate-prod build-prod-tagged deploy deploy-no-push

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

# Деплой на сервер: пуш в origin main, затем на сервере git pull, build, stack deploy, alembic upgrade.
# Требует на сервере: docker swarm init (один раз). Лимиты deploy.resources применяются только при stack deploy.
# Переопределить: make deploy DEPLOY_HOST=1.2.3.4 DEPLOY_PATH=/home/app/smart_trainer
deploy:
	git push origin main
	$(MAKE) deploy-no-push

# Только действия на сервере (без git push). Сборка образов, затем docker stack deploy (Swarm) и миграции.
deploy-no-push:
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "cd $(DEPLOY_PATH) && git pull && $(COMPOSE_PROD) build && set -a && . ./.env && set +a && docker stack deploy -c docker-compose.yml -c docker-compose.prod.yml st2 && sleep 20 && docker service exec st2_backend alembic upgrade head"
	@echo "Деплой завершён: https://tsspro.tech"

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
