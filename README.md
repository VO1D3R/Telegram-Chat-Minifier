<details>
<summary><strong>English Version</strong></summary>

# Telegram Chat Minifier Pro

This tool is designed to solve a major problem when working with large Telegram chat archives: their huge size and unsuitability for AI analysis (e.g., for models like GPT, Claude, Llama).

## The Problem

A standard Telegram chat export in `.json` format contains a lot of redundant information, making it highly inefficient for feeding into language models:

- **Huge JSON Size:** Files can reach tens or hundreds of megabytes, which is impossible to load into the context window of most models.
- **Excessive Noise:** A vast amount of metadata, formatting, message IDs, and unique timestamps for every message "eats up" precious space.
- **High Token Cost:** A large number of unnecessary characters directly leads to increased token consumption, making analysis expensive or altogether impossible.

## ✨ Features

`Telegram Chat Minifier Pro` solves these problems by allowing you to:

- **Filter by User(s):** Select one or more participants to extract only relevant dialogues.
- **Set a Time Window:** Get not only the messages of the selected people but also the context—responses from other participants within a few minutes before and after.
- **Maximize Text Compression:**
  - All unnecessary characters, JSON markup, and metadata are removed.
  - Identical consecutive messages and media spam are grouped with a counter (e.g., `[photo x5]`).
  - Author names are not repeated in a series of messages for better readability.
- **Preserve the Essentials:** Media files are replaced with concise tags (`[photo]`, `[video]`, `[voice message]`), and links can be hidden.
- **Ensure Privacy:** All processing happens locally in your browser. Your data is never sent anywhere.

## ⚡️ Savings Example: Before & After

To understand the scale of optimization, let's look at a small, fictional chat snippet.

### Original Snippet (Before)

```json
  {
   "id": 1001,
   "type": "message",
   "date": "2024-05-10T10:30:00",
   "date_unixtime": "1715326200",
   "from": "Alex",
   "from_id": "user123456789",
   "text": "Are you there?",
   "text_entities": [
    {
     "type": "plain",
     "text": "Are you there?"
    }
   ]
  },
  {
   "id": 1002,
   "type": "message",
   "date": "2024-05-10T10:31:15",
   "date_unixtime": "1715326275",
   "from": "Maria",
   "from_id": "user987654321",
   "reply_to_message_id": 1001,
   "file": "(File not included...)",
   "media_type": "voice_message",
   "mime_type": "audio/ogg",
   "duration_seconds": 3,
   "text": "",
   "text_entities": []
  },
  {
   "id": 1003,
   "type": "message",
   "date": "2024-05-10T10:31:25",
   "date_unixtime": "1715326285",
   "from": "Maria",
   "from_id": "user987654321",
   "file": "(File not included...)",
   "media_type": "voice_message",
   "mime_type": "audio/ogg",
   "duration_seconds": 5,
   "text": "",
   "text_entities": []
  },
    {
   "id": 1004,
   "type": "message",
   "date": "2024-05-10T10:32:00",
   "date_unixtime": "1715326320",
   "from": "Alex",
   "from_id": "user123456789",
   "text": "Got it",
   "text_entities": [
    {
     "type": "plain",
     "text": "Got it"
    }
   ]
  }
```

### Processed Result (After)

```text
[10.05.24]
Alex:Are you there?
Maria:[voice message] (x2)
Alex:Got it
```

### Savings Analysis

| Metric | Before | After | Savings |
| :--- | :--- | :--- | :--- |
| **Characters** | ~1250 | 59 | **~95.3%** |
| **Tokens (approx.)** | ~280 | 14 | **~95.0%** |

As you can see, even on a small segment, the savings exceed 90%. On a full 16 MB chat file, the result will be even more impressive, turning a useless archive for AI into a valuable, compact dataset for analysis.

## 🚀 How to Use

1.  Download all project files (`index.html`, `css` and `js` folders).
2.  Maintain the file structure: the `css` and `js` folders should be next to `index.html`.
3.  Open the `index.html` file in any modern web browser (Google Chrome, Firefox, Edge).
4.  Follow the on-screen instructions: select your JSON file, configure the settings, and process the data.

## 🔒 Privacy

All file reading and processing operations happen **exclusively on your computer**, within your browser. Your data never leaves your machine and is not sent anywhere.

</details>

---

# Telegram Chat Minifier

Этот инструмент создан для решения главной проблемы при работе с большими архивами чатов Telegram: их огромный размер и непригодность для анализа с помощью ИИ (например, для моделей вроде GPT, Claude, Llama).

## Проблема

Стандартный экспорт чата из Telegram в формате `.json` содержит много избыточной информации, что делает его крайне неэффективным для подачи в языковые модели:

- **Огромный размер JSON:** Файлы могут достигать десятков и сотен мегабайт, что невозможно загрузить в контекстное окно большинства моделей.
- **Лишняя информация (шум):** Множество метаданных, форматирование, ID сообщений и уникальные метки времени для каждого сообщения — все это "съедает" драгоценное место.
- **Высокая стоимость токенов:** Большое количество ненужных символов напрямую ведет к увеличению расхода токенов, делая анализ дорогим или вовсе невозможным.

## ✨ Возможности

`Telegram Chat Minifier` решает эти проблемы, позволяя вам:

- **Фильтровать по пользователям:** Выбирайте одного или нескольких участников, чтобы извлечь только релевантные диалоги.
- **Устанавливать временное окно:** Получайте не только сообщения выбранных людей, но и контекст — ответы других участников за несколько минут до и после.
- **Максимально сжимать текст:**
  - Удаляются все лишние символы, JSON-разметка и метаданные.
  - Одинаковые сообщения и медиа-спам группируются с указанием количества (например, `[фото x5]`).
  - Имена авторов в сериях сообщений не повторяются.
- **Сохранять суть:** Медиафайлы заменяются на лаконичные теги (`[фото]`, `[видео]`, `[голосовое сообщение]`), а ссылки можно скрыть.
- **Обеспечивать приватность:** Вся обработка происходит локально в вашем браузере. Ваши данные никуда не отправляются.

## ⚡️ Пример экономии: До и После

Чтобы понять масштаб оптимизации, давайте посмотрим на небольшой фрагмент вымышленного чата.

### Исходный фрагмент (До)

```json
  {
   "id": 1001,
   "type": "message",
   "date": "2024-05-10T10:30:00",
   "date_unixtime": "1715326200",
   "from": "Алекс",
   "from_id": "user123456789",
   "text": "Ты тут?",
   "text_entities": [
    {
     "type": "plain",
     "text": "Ты тут?"
    }
   ]
  },
  {
   "id": 1002,
   "type": "message",
   "date": "2024-05-10T10:31:15",
   "date_unixtime": "1715326275",
   "from": "Мария",
   "from_id": "user987654321",
   "reply_to_message_id": 1001,
   "file": "(File not included...)",
   "media_type": "voice_message",
   "mime_type": "audio/ogg",
   "duration_seconds": 3,
   "text": "",
   "text_entities": []
  },
  {
   "id": 1003,
   "type": "message",
   "date": "2024-05-10T10:31:25",
   "date_unixtime": "1715326285",
   "from": "Мария",
   "from_id": "user987654321",
   "file": "(File not included...)",
   "media_type": "voice_message",
   "mime_type": "audio/ogg",
   "duration_seconds": 5,
   "text": "",
   "text_entities": []
  },
    {
   "id": 1004,
   "type": "message",
   "date": "2024-05-10T10:32:00",
   "date_unixtime": "1715326320",
   "from": "Алекс",
   "from_id": "user123456789",
   "text": "Понял",
   "text_entities": [
    {
     "type": "plain",
     "text": "Понял"
    }
   ]
  }
```

### Результат обработки (После)

```text
[10.05.24]
Алекс:Ты тут?
Мария:[голосовое сообщение] (x2)
Алекс:Понял
```

### Анализ экономии

| Метрика | До | После | Экономия |
| :--- | :--- | :--- | :--- |
| **Символы** | ~1250 | 63 | **~95.0%** |
| **Токены (приблизительно)** | ~280 | 14 | **~95.0%** |

Как видите, даже на небольшом отрезке экономия превышает 90%. На полном файле чата размером 16 МБ результат будет еще более впечатляющим, превращая бесполезный для ИИ архив в ценный, компактный датасет для анализа.

## 🚀 Как использовать

1.  Скачайте все файлы проекта (`index.html`, папки `css` и `js`).
2.  Сохраните структуру файлов: папки `css` и `js` должны находиться рядом с `index.html`.
3.  Откройте файл `index.html` в любом современном веб-браузере (Google Chrome, Firefox, Edge).
4.  Следуйте инструкциям на экране: выберите ваш JSON-файл, настройте параметры и обработайте данные.

## 🔒 Приватность

Все операции по чтению и обработке файла происходят **исключительно на вашем компьютере**, в вашем браузере. Ваши данные никогда не покидают ваш компьютер и никуда не отправляются.
