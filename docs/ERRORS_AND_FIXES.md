# Ошибки и решения (Errors and Fixes)

Отчёт по ошибкам из Sentry, логов и их устранению.

---

## Формат записи

| Поле | Описание |
|------|----------|
| Дата | Когда обнаружена |
| Место | Файл/модуль, строка |
| Ошибка | Симптом, исключение |
| Причина | Корневая причина |
| Решение | Что сделано |
| Статус | Исправлено / Ожидает |

---

## Записи

### 1. Orchestrator Gemini call crash (run_daily_decision)

**Дата:** 2026-03-08  
**Место:** `backend/app/services/orchestrator.py`, `run_daily_decision` ~line 508  
**Цепочка:** `app/main.py` → `run_for_user` → `run_daily_decision` → `run_generate_content` → Gemini API  
**Ошибка:** Исключение при вызове Gemini (таймаут, 429, сеть) — джоб падал, ошибка уходила в Sentry.  
**Причина:** Вызов `run_generate_content` не был обёрнут в try/except.  
**Решение:** Обернуть создание модели и вызов Gemini в try/except; при исключении логировать с `logger.exception` и возвращать `OrchestratorResponse(decision=Decision.SKIP, reason="AI unavailable; defaulting to Skip.")`.  
**Коммит:** `4a18800`  
**Статус:** Исправлено

### 2. SQLAlchemy AsyncSession concurrent operations / close() conflict

**Дата:** 2026-03-08  
**Место:** `backend/app/db/session.py` (get_db), `backend/app/api/v1/chat.py` (send_message), `backend/app/services/orchestrator.py`, `backend/app/services/weekly_summary.py`  
**Цепочка:** `send_message` → `run_daily_decision` / `_build_athlete_context` → `asyncio.gather(session.execute(...), ...)`  
**Ошибка:**  
- `InvalidRequestError: This session is provisioning a new connection; concurrent operations are not permitted`  
- `Method 'close()' can't be called here; method '_connection_for_bind()' is already in progress`  
**Причина:** AsyncSession не поддерживает параллельные операции на одной сессии. `asyncio.gather` с несколькими `session.execute()` вызывал конфликт состояний и блокировку при `close()` в `get_db`.  
**Решение:** Заменить `asyncio.gather(session.execute(...), ...)` на последовательные `await session.execute(...)` в `run_daily_decision`, `_build_athlete_context`, `_build_week_data_text`.  
**Статус:** Исправлено
