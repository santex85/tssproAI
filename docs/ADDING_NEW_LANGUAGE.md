# Добавление нового языка (i18n / locale)

Инструкция для быстрого добавления нового языка в приложение (например, `de`, `fr`, `es`). Опирается на текущую реализацию смены языка: UI переводится через словари, бэкенд и ИИ получают локаль из заголовка или профиля, пуши отправляются на языке пользователя.

---

## 1. Обзор реализации

### 1.1 Поток данных

```
[Пользователь выбирает язык]
        ↓
Frontend: I18nProvider (locale, setLocale) → AsyncStorage "@smart_trainer/locale"
        ↓
Frontend: setApiLocale(locale) → каждый запрос с заголовком X-App-Language
        ↓
Frontend: updateAthleteProfile({ locale }) → бэкенд сохраняет в User.locale
        ↓
Backend: get_request_locale() → заголовок или User.locale из БД → "ru" | "en" | ...
        ↓
Backend: эндпоинты передают locale в Gemini-сервисы и в словари пушей
```

### 1.2 Где используется локаль

| Место | Назначение |
|-------|------------|
| **Frontend** | Словарь переводов `messages[locale]`, заголовок `X-App-Language`, сохранение в профиле |
| **Backend deps** | `SUPPORTED_LOCALES`, `get_request_locale`, нормализация при PATCH профиля |
| **Gemini (AI)** | Системные промпты: ответы и текстовые значения строго на языке пользователя; ключи JSON всегда на английском |
| **Push-уведомления** | Заголовки и тела пушей из словарей по `locale` (recovery, sleep reminder, orchestrator) |

---

## 2. Frontend

### 2.1 Словарь переводов

**Файл:** `frontend/src/i18n/translations.ts`

- Объекты: `ru`, `en` — одинаковой структуры (вложенные ключи).
- Экспорт: `export type Locale = "ru" | "en"`; `export const messages = { ru, en } as const`.
- Ключи обращаются через точку: `t("app.loading")`, `t("nutrition.entryEditTitle")`, `t("camera.mealBreakfast")`.

**Топ-уровни ключей (должны совпадать у всех языков):**

- `app` — загрузка, ошибки, бренд, выход
- `settings` — настройки, тема, смена языка, назад, langRu, langEn, langSwitchToEn, langSwitchToRu
- `common` — close, cancel, error, save, delete, menu, sync, send, rename, email, alerts.*
- `units` — hourShort, minuteShort
- `tabs` — home, chat, profile, analytics
- `analytics` — title, overview, sleep, training, nutrition, askAi, insightPlaceholder, loadingInsight, getAnswer, noData, days, avgSleep, workoutsCount, totalTss, caloriesPerDay, loadCtl, loadAtl, loadTsb
- `auth` — login, loginTitle, register, registerCta, createAccount, password, email, passwordHint, emailMinLength, emailRequired, haveAccount, requestError
- `nutrition` — title, eaten, left, kcal, proteinShort, fatShort, carbsShort, grams, goal, caloriesLabel, proteinLabel, fatLabel, carbsLabel, placeholder, loadError, copy, recalculate, recalculateHint, micronutrients, entryEditTitle, entryName, dishNamePlaceholder, portionG, entryCalories, entryProtein, entryFat, entryCarbs, mealType, micronutrientLabels.*
- `wellness` — title, edit, hint, todayLabel, disclaimer, sleep, sleepHours, weight, weightKg, manualHint, placeholder, addByPhoto, weeklySleep, deficit, normPerNight, noData, sleepByPhoto, history, historyManual, insufficientData, uploadSleepPhotoHint, sleepReminder, enterManually, uploadScreenshot, deleteEntry, deleteSleepEntryTitle, deleteSleepEntryMessage, deleteSleepEntryConfirm, sleepPlaceholder, rhrPlaceholder, hrvPlaceholder, weightPlaceholder, reanalyze, sendToAnalysis, reanalyzePlaceholder, totalLabel
- `chat` — title, openCoachChat, clear, placeholder, emptyPrompt, quickPrompt1–3, attachedFIT, addToDiary, addToDiaryDone, send, solutionToday, renameTitle, renamePlaceholder, deleteChatConfirmTitle, deleteChatConfirmMessage, defaultThreadName, newChat, requestFailed, attachFileError, renameError, deleteFailed, fitAttachmentLabel, solutionQuestion
- `dashboard` — валидации, saveFailed, deleteFailed, copyFailed, parseFitFailed, deleteEntryConfirm, deleteEntryMessage, deleteWorkoutTitle, deleteWorkoutMessage, galleryAccessRequired, workoutRecognizeFailed, selectImageFailed, wellnessModalTitle, placeholderWorkoutName, placeholderFeelings, sportTypePlaceholder, analysisResult, decisionLabel, runAnalysis, noWorkoutsHint, workoutFallbackName, photo, syncDoneNoData, syncIntervalsTitle, workoutSourceFit/Intervals/Manual, workoutDetail*, addWorkout*, scanPhoto, hrAvg, hrMax, avgPower, avgPowerShort, caloriesLabel, syncIntervalsMessage
- `intervals` — titleLink, titleUpdate, athleteIdPlaceholder, apiKeyPlaceholder, hint, sync, save, connect, loading, linkSuccess, syncSuccess, linkError, syncError, athleteIdRequired, connected, athleteIdLabel, apiKeyLabel, unlinkConfirmText, unlink, openIntervals
- `fitness` — title, hint, dateLabel, fromWellness, placeholder, sync
- `workouts` — title, uploadFit, add, hint
- `camera` — portion, mealBreakfast, mealLunch, mealDinner, mealSnack, mealOther, dishPlaceholder, checkAndSave, savedClose, needPhotoAccess, needCameraAccess, pulseSaved, sleepSaved, getPhotoError, needAccess, photoTitle, analysisHint, nameLabel, mealTypeLabel, portionLabel, sleepRecognized, wellnessRecognized, rhrLabel, noRhrHrv, selectPhotoHint, done, takePhoto, selectFromGallery
- `athleteProfile` — title, subscription, subscriptionPro, premiumTestLabel, ftpPlaceholder, gramsShort, weightKg, nutritionGoals, setCalories, setBju, caloriesPerDay, profileHint, athleteData, height, birthYear, ftp, editProfile
- `wellnessScreen` — title, sleepTrendTitle, sleepHoursLabel, saved, saveFailed, validation*, dataForDate, rhrLabel, loadReadOnly, savedTitle
- `fit` — webOnly, previewTitle
- `pricing` — title, subtitle, free, pro, perMonth, perYear, monthly, annual, trialBadge, savePercent, ctaMonthly, ctaAnnual, upgradeRequired, upgradeCta, limitReached, manageSubscription, currentPlan, checkoutError
- `errors` — requestError

Для нового языка скопировать один из объектов (например `en`), заменить значения на переводы, сохранить под новым именем (например `de`) и добавить в тип и в `messages`.

### 2.2 Контекст и хранилище

**Файл:** `frontend/src/i18n/context.tsx`

- Ключ AsyncStorage: `@smart_trainer/locale`.
- При загрузке: `if (stored === "ru" || stored === "en")` — для нового языка добавить условие (например `|| stored === "de"`).
- При инициализации и при смене языка вызывается `setApiLocale(locale)`.

### 2.3 API-клиент

**Файл:** `frontend/src/api/client.ts`

- Переменная: `apiLocale`, по умолчанию `"ru"`.
- `setApiLocale(locale: string)`: сейчас `locale === "en" ? "en" : "ru"`. Для нового языка добавить ветку (например `locale === "de" ? "de" : ...`).
- Заголовок: `X-App-Language: apiLocale` в каждом запросе (через `languageHeader()`).
- При смене языка вызывается `updateAthleteProfile({ locale: next })` (например в `AthleteProfileScreen`).

### 2.4 Выбор языка в UI

- **Сейчас:** переключатель только ru ↔ en (например в `AthleteProfileScreen`: `const next = locale === "ru" ? "en" : "ru"`).
- **Для третьего языка:** заменить переключатель на список языков (массив `["ru", "en", "de"]` и отображение текущего + выбор другого). Названия для списка брать из `t("settings.langRu")`, `t("settings.langEn")` и добавить ключи `settings.langDe` и т.д.

### 2.5 Форматирование дат

**Файл:** `frontend/src/screens/DashboardScreen.tsx`

- `formatNavDate(isoDate, locale: "ru" | "en")`: использует `ru-RU` или `en-US`. Для нового языка расширить тип и добавить маппинг (например `de` → `de-DE`).

---

## 3. Backend

### 3.1 Поддерживаемые локали

**Файл:** `backend/app/api/deps.py`

```python
SUPPORTED_LOCALES = frozenset({"ru", "en"})
```

- Добавить новый код: `SUPPORTED_LOCALES = frozenset({"ru", "en", "de"})`.
- `_normalize_locale(value)` возвращает значение из `SUPPORTED_LOCALES` или `"ru"`.

### 3.2 Модель пользователя

**Файл:** `backend/app/models/user.py`

- Поле: `locale: Mapped[str | None] = mapped_column(String(10), nullable=True, default="ru")`.
- Миграция не нужна — длина 10 символов достаточна для кодов вроде `de`, `fr`.

### 3.3 Профиль атлета (PATCH)

**Файл:** `backend/app/api/v1/athlete_profile.py`

- В body: `locale: str | None`.
- При `body.locale is not None` вызывается `_normalize_locale(body.locale)` и записывается в `user.locale`. Достаточно добавить код в `SUPPORTED_LOCALES`.

---

## 4. ИИ (Gemini): язык ответов

Во всех перечисленных местах используется маппинг код локали → название языка для промпта (например `Russian`, `English`). Ответы и текстовые значения — на этом языке; ключи JSON всегда на английском.

### 4.1 Оркестратор (дневное решение)

**Файл:** `backend/app/services/orchestrator.py`

```python
LOCALE_LANGUAGE = {"ru": "Russian", "en": "English"}
```

- Добавить: `"de": "German"`, `"fr": "French"` и т.д.
- Используется в `_language_for_locale(locale)` и в системном промпте.

### 4.2 Чат

**Файл:** `backend/app/api/v1/chat.py`

```python
CHAT_LOCALE_LANGUAGE = {"ru": "Russian", "en": "English"}
```

- Добавить те же коды и названия языков.

### 4.3 Питание (Gemini)

**Файл:** `backend/app/services/gemini_nutrition.py`

```python
def _language_for_locale(locale: str) -> str:
    return {"ru": "Russian", "en": "English"}.get((locale or "ru").lower(), "Russian")
```

- Добавить в словарь новые пары (например `"de": "German"`). Fallback — `"Russian"` или при желании общий дефолт.

### 4.4 Фото (классификация и сон)

**Файл:** `backend/app/services/gemini_photo_analyzer.py`

- Аналогично: расширить словарь в `_language_for_locale(locale)`.

### 4.5 Парсер сна

**Файл:** `backend/app/services/gemini_sleep_parser.py`

- Аналогично: расширить `_language_for_locale(locale)`.

### 4.6 Аналитика (insight)

**Файл:** `backend/app/api/v1/analytics.py`

- Функция `_language_for_locale(locale)` — добавить новые коды в словарь.

---

## 5. Push-уведомления

Тексты пушей задаются словарями по коду локали. При неизвестной локали используется fallback (`ru` или `en`).

### 5.1 Напоминание о сне

**Файл:** `backend/app/main.py`

```python
SLEEP_REMINDER_BY_LOCALE = {
    "ru": ("Сон", "Укажите данные сна за сегодня или загрузите скриншот."),
    "en": ("Sleep", "Enter today's sleep data or upload a screenshot."),
}
```

- Добавить запись для нового языка: `"de": ("Schlaf", "Bitte Schlafdaten für heute eingeben oder Screenshot hochladen.")`.

### 5.2 Заголовок пуша оркестратора (daily decision)

**Файл:** `backend/app/main.py`

```python
ORCHESTRATOR_PUSH_TITLE_BY_LOCALE = {
    "ru": "Решение на день",
    "en": "Daily decision",
}
```

- Добавить, например: `"de": "Tagesentscheidung"`. В коде используется `.get(locale, ORCHESTRATOR_PUSH_TITLE_BY_LOCALE["en"])`.

### 5.3 Recovery (напоминание после тяжёлой тренировки)

**Файл:** `backend/app/services/retention.py`

```python
RECOVERY_PUSH_BY_LOCALE = {
    "ru": ("Восстановление", "Вчера была тяжёлая тренировка. Открой приложение — там советы по восстановлению."),
    "en": ("Recovery", "You had a heavy workout yesterday. Open the app for recovery advice."),
}
```

- Добавить пару (title, body) для нового языка. При отсутствии локали в словаре используется `"ru"`.

---

## 6. Чек-лист: добавление языка (например `de`)

Используйте как пошаговый список; порядок можно менять, но лучше сначала бэкенд и словари, затем UI.

### Frontend

- [ ] **translations.ts**
  - Добавить объект `de` с той же структурой, что у `ru`/`en` (все ключи переведены).
  - Расширить тип: `export type Locale = "ru" | "en" | "de"`.
  - Добавить в объект сообщений: `export const messages = { ru, en, de } as const`.
- [ ] **context.tsx**
  - В проверке при загрузке из AsyncStorage добавить: `|| stored === "de"`.
- [ ] **client.ts**
  - В `setApiLocale`: добавить ветку для `"de"` (например `locale === "de" ? "de" : ...`).
- [ ] **Settings / профиль**
  - Добавить в переводы: `settings.langDe` (и при необходимости `settings.langSwitchToDe`).
  - Заменить переключатель ru↔en на выбор из списка языков `["ru", "en", "de"]` или добавить третью кнопку/пункт для `de`.
  - При смене на `de` вызывать `setLocale("de")`, `setApiLocale("de")`, `updateAthleteProfile({ locale: "de" })`.
- [ ] **formatNavDate** (DashboardScreen)
  - Расширить тип второго аргумента на `"ru" | "en" | "de"` и маппинг для `toLocaleDateString` (например `de` → `de-DE`).

### Backend

- [ ] **deps.py**
  - Добавить `"de"` в `SUPPORTED_LOCALES`.
- [ ] **orchestrator.py**
  - В `LOCALE_LANGUAGE` добавить `"de": "German"`.
- [ ] **chat.py**
  - В `CHAT_LOCALE_LANGUAGE` добавить `"de": "German"`.
- [ ] **gemini_nutrition.py**, **gemini_photo_analyzer.py**, **gemini_sleep_parser.py**, **analytics.py**
  - В соответствующих `_language_for_locale` добавить `"de": "German"`.
- [ ] **main.py**
  - В `SLEEP_REMINDER_BY_LOCALE` и `ORCHESTRATOR_PUSH_TITLE_BY_LOCALE` добавить записи для `"de"`.
- [ ] **retention.py**
  - В `RECOVERY_PUSH_BY_LOCALE` добавить запись для `"de"`.

### Проверка

- [ ] Выбор языка в приложении сохраняется и отображается корректно.
- [ ] После смены языка интерфейс перерисовывается на выбранный язык.
- [ ] Запросы к API уходят с заголовком `X-App-Language: de` (или выбранный код).
- [ ] PATCH профиля с `locale: "de"` сохраняется в БД.
- [ ] Ответы ИИ (чат, анализ еды, оркестратор, аналитика) на выбранном языке.
- [ ] Парсинг JSON (БЖУ, сон) не ломается — ключи остаются на английском.
- [ ] Пуш-уведомления (sleep reminder, recovery, daily decision) приходят на выбранном языке (при наличии записей в словарях).

---

## 7. Важные замечания

- **Ключи JSON от ИИ:** во всех промптах явно указано: ключи только на английском (`calories`, `protein_g`, `sleep_hours` и т.д.); переводить на язык пользователя только текстовые значения (названия блюд, советы, reason, suggestions_next_days). Иначе парсеры на бэкенде сломаются.
- **Fallback:** везде, где локаль неизвестна или не поддерживается, используется `"ru"` (или в пушах иногда `"en"`). Новый язык нужно явно добавлять во все словари и в `SUPPORTED_LOCALES`.
- **Даты и числа:** кроме `formatNavDate` на фронте даты могут форматироваться в других местах; при добавлении языка стоит проверить экраны с датами и при необходимости передавать `locale` в форматтеры.

После выполнения чек-листа новый язык будет работать в UI, в API, в ответах ИИ и в пуш-уведомлениях.

---

## 8. Краткая сводка: файлы для правок

| Область | Файл | Что менять |
|--------|------|------------|
| Frontend: словарь | `frontend/src/i18n/translations.ts` | Новый объект `de` (или др.), тип `Locale`, `messages` |
| Frontend: контекст | `frontend/src/i18n/context.tsx` | Условие загрузки из AsyncStorage (`stored === "de"`) |
| Frontend: API | `frontend/src/api/client.ts` | `setApiLocale`: ветка для нового кода |
| Frontend: выбор языка | `frontend/src/screens/AthleteProfileScreen.tsx`, при необходимости `DashboardScreen.tsx` | Список языков, ключи `settings.langDe` и т.д. |
| Frontend: даты | `frontend/src/screens/DashboardScreen.tsx` | `formatNavDate`: тип и маппинг locale → BCP 47 |
| Backend: локали | `backend/app/api/deps.py` | `SUPPORTED_LOCALES` |
| Backend: оркестратор | `backend/app/services/orchestrator.py` | `LOCALE_LANGUAGE` |
| Backend: чат | `backend/app/api/v1/chat.py` | `CHAT_LOCALE_LANGUAGE` |
| Backend: питание | `backend/app/services/gemini_nutrition.py` | Словарь в `_language_for_locale` |
| Backend: фото | `backend/app/services/gemini_photo_analyzer.py` | Словарь в `_language_for_locale` |
| Backend: сон | `backend/app/services/gemini_sleep_parser.py` | Словарь в `_language_for_locale` |
| Backend: аналитика | `backend/app/api/v1/analytics.py` | Словарь в `_language_for_locale` |
| Backend: пуши сон/оркестратор | `backend/app/main.py` | `SLEEP_REMINDER_BY_LOCALE`, `ORCHESTRATOR_PUSH_TITLE_BY_LOCALE` |
| Backend: пуши recovery | `backend/app/services/retention.py` | `RECOVERY_PUSH_BY_LOCALE` |
