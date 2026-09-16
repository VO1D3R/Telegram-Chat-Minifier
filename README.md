<details>
<summary><strong>English Version</strong></summary>

# Telegram Chat Minifier

A local tool that turns bulky Telegram chat exports into a compact, LLM-friendly transcript: it strips metadata, collapses media spam into short tags, and keeps the dialogue readable for models like GPT, Claude, or Llama.

## The Problem

A standard Telegram JSON export is extremely inefficient to feed into a language model:

- **Huge size** — tens or hundreds of megabytes, far beyond most context windows.
- **Noise** — IDs, entities, timestamps, and media metadata for every message.
- **Token cost** — all that redundancy is paid for on every request.

## ✨ Features

- **Filter by participants** — select one or several people by their `from_id` (same-named people stay distinct).
- **Time window** — take a person's messages plus the surrounding context from everyone else.
- **Reply chains** — keep a person's messages together with the replies to them and the messages they replied to.
- **Date range** — interpreted in the chat owner's timezone, stored inside the export itself (output does not depend on the machine that runs the tool).
- **Compression presets** — Safe / Balanced / Aggressive, plus fine-tuned toggles:
  - links → `[URL]`, albums → `[фото x4]`, identical repeats → `да (x3)`;
  - media replaced by short tags with durations (`[голос 0:45]`);
  - polls, locations, contacts, and service events (calls, joins) are never silently lost;
  - optional anonymization: stable per-person aliases `User1, User2…`, forwards included.
- **Honest statistics** — compression is measured against the real size of the source file, not a made-up constant.
- **Privacy** — zero network requests: no CDNs, no fonts, no analytics. Opens straight from `file://`.

## ⚡ Output Format

```text
[2024-05-10]
10:30 Алекс: Ты тут?
10:31 Мария: > [голос 0:03]
10:31   [голос 0:05]
10:32 Алекс: Понял
```

- `[YYYY-MM-DD]` — day header, days separated by a blank line.
- `HH:MM Author: text` — the author is printed only when it changes (the double space marks continuation lines).
- `>` — a reply; `[fwd Имя]` — a forwarded message; `[URL]` — a masked link.
- Media tags: `[фото]`, `[видео 2:31]`, `[голос 0:45]`, `[кружок 1:02]`, `[gif]`, `[аудио: Исполнитель — Трек]`, `[файл: report.pdf]`, `[стикер]` / `[😂]`, `[опрос: вопрос]`, `[геометка: место]`, `[контакт: Имя]`.
- If, after filtering, a single author remains, their name is omitted entirely.

## 🚀 How to Use

1. Download the project files (`index.html`, `css/`, `js/`).
2. Open `index.html` in any modern browser — no server or build step needed.
3. Drop in a Telegram export (`result.json` or `result.json.txt`), pick a preset and scope, press **Сжать**.
4. Copy the result or download it as a `.txt` file.

## 🔒 Privacy

All processing happens in your browser via a Web Worker. The page makes **no network requests at all** — even fonts are local. Your data never leaves your machine.

## 🛠 Development

```bash
npm test                                  # unit tests (no dependencies, Node 16+)
node test/core.test.mjs result.json       # smoke test on a real export
```

The entire compression logic lives in `js/core.js` as one environment-agnostic function (`tgminWorkerCore`) reused by the Web Worker, the UI, and the Node tests. See `CHANGELOG.md` for what changed in v2.0.

</details>

---

# Telegram Chat Minifier

Локальный инструмент, который превращает громоздкий экспорт чата Telegram в компактную расшифровку для анализа LLM: убирает метаданные, схлопывает медиа-спам в короткие теги и сохраняет диалог читаемым для моделей вроде GPT, Claude или Llama.

## Проблема

Стандартный JSON-экспорт Telegram крайне неэффективен для подачи в языковую модель:

- **Огромный размер** — десятки и сотни мегабайт, far за пределами контекстного окна большинства моделей.
- **Шум** — ID, сущности, дублирующиеся метки времени и метаданные медиа у каждого сообщения.
- **Стоимость токенов** — за всю эту избыточность приходится платить в каждом запросе.

## ✨ Возможности

- **Фильтр по участникам** — выбор одного или нескольких людей по `from_id` (однофамильцы и тёзки не сливаются в одного участника).
- **Временное окно** — сообщения выбранных людей плюс контекст от всех остальных вокруг них.
- **Reply-цепочки** — сообщения человека вместе с ответами на них и с теми сообщениями, на которые он отвечал.
- **Диапазон дат** — трактуется в часовом поясе владельца экспорта, который хранится в самом файле (вывод не зависит от машины, где запущен инструмент).
- **Пресеты сжатия** — Бережный / Баланс / Агрессивный, плюс тонкая настройка:
  - ссылки → `[URL]`, альбомы → `[фото x4]`, одинаковые повторы → `да (x3)`;
  - медиа заменяется короткими тегами с длительностью (`[голос 0:45]`);
  - опросы, геометки, контакты и сервисные события (звонки, вход/выход) не теряются молча;
  - опциональная анонимизация: стабильные псевдонимы на человека `User1, User2…`, включая имена из пересылок.
- **Честная статистика** — сжатие считается от реального размера исходного файла, а не от выдуманной константы.
- **Приватность** — ноль сетевых запросов: ни CDN, ни шрифтов, ни аналитики. Открывается прямо с `file://`.

## ⚡ Формат вывода

```text
[2024-05-10]
10:30 Алекс: Ты тут?
10:31 Мария: > [голос 0:03]
10:31   [голос 0:05]
10:32 Алекс: Понял
```

- `[YYYY-MM-DD]` — заголовок дня, дни разделены пустой строкой.
- `HH:MM Автор: текст` — автор печатается только при смене (двойной пробел отмечает продолжение серии).
- `>` — ответ; `[fwd Имя]` — пересланное сообщение; `[URL]` — скрытая ссылка.
- Теги медиа: `[фото]`, `[видео 2:31]`, `[голос 0:45]`, `[кружок 1:02]`, `[gif]`, `[аудио: Исполнитель — Трек]`, `[файл: report.pdf]`, `[стикер]` / `[😂]`, `[опрос: вопрос]`, `[геометка: место]`, `[контакт: Имя]`.
- Если после фильтров остаётся один автор, его имя опускается целиком.

## 🚀 Как использовать

1. Скачайте файлы проекта (`index.html`, папки `css` и `js`).
2. Откройте `index.html` в любом современном браузере — сервер и сборка не нужны.
3. Перетащите экспорт Telegram (`result.json` или `result.json.txt`), выберите пресет и область выборки, нажмите **Сжать**.
4. Скопируйте результат или скачайте его как `.txt`.

## 🔒 Приватность

Вся обработка идёт в браузере, в Web Worker. Страница **не делает ни одного сетевого запроса** — даже шрифты локальные. Ваши данные не покидают компьютер.

## 🛠 Разработка

```bash
npm test                                  # unit-тесты (без зависимостей, Node 16+)
node test/core.test.mjs result.json       # smoke-тест на реальном экспорте
```

Вся логика сжатия живёт в `js/core.js` в одной не зависящей от окружения функции (`tgminWorkerCore`), которую переиспользуют Web Worker, интерфейс и Node-тесты. Список изменений v2.0 — в `CHANGELOG.md`.
