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

### 2. [Следующие ошибки добавлять по аналогии]
