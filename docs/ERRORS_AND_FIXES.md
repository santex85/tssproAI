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
**Место:** `backend/app/db/session.py` (get_db), `backend/app/api/v1/chat.py` (send_message, send_message_with_file, send_message_with_image и др.)  
**Цепочка:** `send_message` → несколько `session.commit()` в endpoint → при return `get_db` делает ещё один commit и close → конфликт состояний.  
**Ошибка:**  
- `InvalidRequestError: This session is provisioning a new connection; concurrent operations are not permitted`  
- `Method 'close()' can't be called here; method '_connection_for_bind()' is already in progress`  
**Причина:** В endpoints с `Depends(get_db)` вызывался явный `session.commit()`, а при выходе `get_db` делал второй commit и close. Двойной commit и конфликт при close вызывали ошибку.  
**Решение:** Убрать явные `session.commit()` из chat endpoints; использовать `session.flush()` для промежуточных шагов (чтобы следующие запросы видели данные); финальный commit делает только `get_db` при выходе из generator.  
**Статус:** Исправлено

### 3. DashboardScreen ReferenceError: Cannot access 'M' before initialization

**Дата:** 2026-03-08  
**Место:** `frontend/src/screens/DashboardScreen.tsx`, рендер (стек: `_e.DashboardScreen`, AppEntry)  
**Ошибка:** `ReferenceError: Cannot access 'M' before initialization` (minified)  
**Причина:** Вероятно порядок инициализации модуля или circular dependency при загрузке `react-native-gifted-charts` (LineChart). Ошибка при старте/рендере DashboardScreen.  
**Решение:** Вынести LineChart в отдельный компонент `WorkoutChart` с отложенной загрузкой (require при первом рендере), чтобы не инициализировать gifted-charts при загрузке DashboardScreen.  
**Статус:** Исправлено

### 4. Orchestrator всегда возвращает SKIP, AI не работает

**Дата:** 2026-03-08  
**Место:** `backend/app/services/orchestrator.py`, `run_daily_decision`  
**Ошибка:** Оркестратор не работает — пользователь всегда получает SKIP вместо Go/Modify.  
**Причина:** Gemini API не вызывается успешно (пустой GOOGLE_GEMINI_API_KEY, ошибка модели, квота, сеть). try/except ловит исключение и возвращает SKIP.  
**Решение:** Ранний выход при пустом API-ключе с явным логом; предупреждение при старте приложения; улучшенное логирование исключения (str(e)) в except.  
**Статус:** Исправлено

### 5. Orchestrator ValueError: Unknown field for Schema: $defs

**Дата:** 2026-03-08  
**Место:** `backend/app/services/orchestrator.py`, `run_daily_decision` (GenerationConfig, response_schema)  
**Ошибка:** `ValueError: Unknown field for Schema: $defs` при вызове Gemini.  
**Причина:** Gemini API не поддерживает `$defs` и `$ref` в response_schema; Pydantic генерирует их для вложенных типов.  
**Решение:** Функция `_inline_schema_for_gemini` инлайнит все `$ref` из `$defs` и удаляет `$defs`/`title` перед передачей в GenerationConfig.  
**Статус:** Исправлено

### 6. Orchestrator ValueError: Protocol message Schema has no "maxLength" field

**Дата:** 2026-03-08  
**Место:** `backend/app/services/orchestrator.py`, `run_daily_decision` (GenerationConfig, response_schema)  
**Ошибка:** `ValueError: Protocol message Schema has no "maxLength" field.` при вызове Gemini (proto/marshal/rules/message.py).  
**Причина:** Gemini API protobuf Schema не поддерживает `maxLength`, `minLength`, `pattern` и др.; Pydantic генерирует их для `Field(max_length=...)`.  
**Решение:** Рекурсивно удалять unsupported поля (`maxLength`, `minLength`, `pattern`, `example`, `default`, `title`) в `_inline_schema_for_gemini` перед передачей в GenerationConfig.  
**Статус:** Исправлено
