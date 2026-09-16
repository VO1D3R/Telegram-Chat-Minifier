/* ============================================================================
 * js/core.js — ядро Telegram Chat Minifier 2.0
 * ----------------------------------------------------------------------------
 * Вся логика загрузки и сжатия экспорта живёт в ОДНОЙ функции
 * tgminWorkerCore(self), которая не зависит от DOM и окружения:
 *
 *   - В браузере js/app.js создаёт Web Worker из Blob(this.toString()),
 *     поэтому ядро работает и с file:// (без сети и сборки).
 *   - В Node (тесты) функция вызывается с фейковым self — так же, как воркер.
 *
 * Ядро отдаёт api через self.__tgmin — и для воркера, и для тестов.
 * ========================================================================== */
'use strict';
function tgminWorkerCore(self) {
    'use strict';

    // ══════════════════════════════════════════
    // КОНСТАНТЫ
    // ══════════════════════════════════════════
    const DAY_SEC = 86400;
    const ALBUM_GAP_SEC = 10;     // макс. разрыв между медиа одного «альбома»
    const REPEAT_GAP_SEC = 120;   // макс. разрыв между одинаковыми текстами для группировки
    const READ_PROGRESS_MAX = 70; // % прогресса, отводимый на чтение файла
    const PARSE_PROGRESS = 75;    // % после JSON.parse
    const INDEX_PROGRESS = 90;    // % после индексации
    const POLL_QUESTION_MAX = 120;

    const MODES = ['all', 'window', 'only', 'replies'];

    // Сообщения «только из эмодзи». Внимание: цифры/#/* в Extended_Pictographic
    // НЕ входят (проверено), поэтому числовые сообщения этим фильтром не теряются.
    const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\s]+$/u;
    const EMOJI_ONLY_MAX_LEN = 40;

    // ══════════════════════════════════════════
    // УТИЛИТЫ
    // ══════════════════════════════════════════
    const pad2 = (n) => String(n).padStart(2, '0');

    function clampInt(value, def, min, max) {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n)) return def;
        return Math.min(max, Math.max(min, n));
    }

    function formatDuration(sec) {
        sec = Math.max(0, Math.round(Number(sec) || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
    }

    function sanitizeFileName(name) {
        const clean = String(name || '')
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .trim()
            .replace(/\s+/g, '_')
            .slice(0, 64);
        return clean || 'chat';
    }

    function isEmojiOnly(trimmedText) {
        return trimmedText.length <= EMOJI_ONLY_MAX_LEN && EMOJI_ONLY_RE.test(trimmedText);
    }

    // ══════════════════════════════════════════
    // ИЗВЛЕЧЕНИЕ ТЕКСТА И МЕДИА
    // ══════════════════════════════════════════
    /**
     * Telegram кладёт текст либо строкой, либо массивом сегментов
     * (строка | {type, text, href}).
     *
     * Возвращаем:
     *   text — полный текст как есть;
     *   segs — null, если «ссылочных» сегментов нет (маскировка не нужна,
     *          экономим память на 95%+ сообщений), иначе [{t, link}].
     *
     * Маскируются только реальные гиперссылки (text_link/link).
     * Упоминания @name, e-mail, phone сохраняем — это содержательные данные.
     */
    function extractText(m) {
        const parts = m.text;
        if (!Array.isArray(parts)) {
            const t = typeof parts === 'string' ? parts : '';
            return { text: t, segs: null };
        }
        let text = '';
        let hasLink = false;
        const segs = [];
        for (const part of parts) {
            if (typeof part === 'string') {
                text += part;
                segs.push({ t: part, link: false });
                continue;
            }
            const t = part.text || '';
            text += t;
            const isLink = part.type === 'text_link' || part.type === 'link';
            if (isLink) hasLink = true;
            segs.push({ t, link: isLink });
        }
        return { text, segs: hasLink ? segs : null };
    }

    /** Человекочитаемый тег медиа или null. Ничего не теряем молча. */
    function describeMedia(m) {
        const dur = Number(m.duration_seconds);
        const durSuffix = Number.isFinite(dur) && dur > 0 ? ' ' + formatDuration(dur) : '';

        if (m.media_type === 'sticker' || m.sticker_emoji) {
            const e = m.sticker_emoji || '';
            return { media: e ? `[${e}]` : '[стикер]', isSticker: true };
        }
        if (m.photo) return { media: '[фото]', isSticker: false };
        if (m.media_type === 'voice_message') return { media: '[голос' + durSuffix + ']', isSticker: false };
        if (m.media_type === 'video_message') return { media: '[кружок' + durSuffix + ']', isSticker: false };
        if (m.media_type === 'animation') return { media: '[gif]', isSticker: false };
        if (m.media_type === 'video_file' || m.video_file) return { media: '[видео' + durSuffix + ']', isSticker: false };
        if (m.audio_file) {
            const meta = [m.performer, m.title].filter(Boolean).join(' — ');
            return { media: '[аудио' + (meta ? ': ' + meta : '') + durSuffix + ']', isSticker: false };
        }
        if (m.poll) {
            const q = String((m.poll && m.poll.question) || '').replace(/\s+/g, ' ').trim().slice(0, POLL_QUESTION_MAX);
            return { media: q ? `[опрос: ${q}]` : '[опрос]', isSticker: false };
        }
        if (m.location_information) {
            const place = m.location_information.place_name || m.location_information.title || '';
            return { media: place ? `[геометка: ${place}]` : '[геометка]', isSticker: false };
        }
        if (m.contact_information) {
            const c = m.contact_information || {};
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
            return { media: name ? `[контакт: ${name}]` : '[контакт]', isSticker: false };
        }
        if (m.file) return { media: m.file_name ? `[файл: ${m.file_name}]` : '[файл]', isSticker: false };
        if (m.media_type) return { media: `[${m.media_type}]`, isSticker: false };
        return { media: null, isSticker: false };
    }

    /** Текст сервисного сообщения. actor анонимизируется тем же маппингом. */
    function describeService(m, actorAlias) {
        const who = m.actor ? actorAlias : '';
        const dur = Number(m.duration);
        const durStr = Number.isFinite(dur) && dur > 0 ? ' ' + formatDuration(dur) : '';
        switch (m.action) {
            case 'join': return `${who} присоединился к чату`;
            case 'leave': return `${who} покинул чат`;
            case 'phone_call': return `[звонок${durStr}]${who ? ' ' + who : ''}`;
            case 'pin': case 'pin_video_message': case 'pin_audio':
                return `[закреплено сообщение]${who ? ' ' + who : ''}`;
            case 'migrate_to_supergroup': return '[чат преобразован в супергруппу]';
            case 'suggest_profile_photo': return `[предложено фото профиля]${who ? ' ' + who : ''}`;
            case 'set_chat_photo': return '[обновлено фото чата]';
            case 'change_chat_title': return '[изменено название чата]';
            case 'group_call': case 'group_call_started': return '[групповой звонок]';
            default: return `[сервис: ${m.action || 'событие'}]`;
        }
    }

    // ══════════════════════════════════════════
    // ЗАГРУЗКА ЭКСПОРТА
    // ══════════════════════════════════════════
    /**
     * @param {object} raw — распарсенный result.json
     * @param {number} [sourceChars] — размер исходного файла в символах (для честной статистики)
     * @returns {{ chat: object, meta: object }}
     */
    function loadChat(raw, sourceChars) {
        if (!raw || !Array.isArray(raw.messages)) {
            throw new Error('Файл не содержит массив "messages" — это не экспорт Telegram');
        }

        const msgs = [];
        const userCounts = new Map(); // fromId || 'name:'+from → count
        let minTs = Infinity;
        let maxTs = -Infinity;
        let skippedNoTs = 0;
        let tzOffset = null; // смещение «настенных» часов экспортёра, сек

        for (const m of raw.messages) {
            const ts = Number(m.date_unixtime);
            if (!Number.isFinite(ts)) { skippedNoTs++; continue; }
            if (ts < minTs) minTs = ts;
            if (ts > maxTs) maxTs = ts;

            // Часовой пояс берём из самого экспорта: строка date — «настенное»
            // время экспортёра, date_unixtime — абсолютное UTC.
            if (tzOffset === null && typeof m.date === 'string' && m.date.length >= 19) {
                const asUtc = Date.parse(m.date.slice(0, 19) + 'Z');
                if (Number.isFinite(asUtc)) {
                    const off = Math.round(asUtc / 1000) - ts;
                    if (Math.abs(off) <= 14 * 3600) tzOffset = off;
                }
            }

            const from = m.from || '';
            const fromId = m.from_id || (from ? 'name:' + from : '');
            if (m.type === 'message' && from) {
                userCounts.set(fromId, (userCounts.get(fromId) || 0) + 1);
            }

            const { text, segs } = extractText(m);
            const { media, isSticker } = describeMedia(m);

            msgs.push({
                id: m.id,
                ts,
                type: m.type || 'message',
                from,
                fromId,
                reply: m.reply_to_message_id || 0,
                fwd: m.forwarded_from || '',
                text,
                segs,           // null для сообщений без ссылок — экономия ~половины памяти
                media,
                isSticker,
                action: m.type === 'service' ? (m.action || '') : '',
                actor: m.actor || '',
                actorId: m.actor_id || '',
                duration: m.duration_seconds,
            });
        }

        if (msgs.length === 0) {
            throw new Error('В файле нет сообщений с распознанной датой');
        }

        msgs.sort((a, b) => a.ts - b.ts);

        const idIndex = new Map();
        for (let i = 0; i < msgs.length; i++) idIndex.set(msgs[i].id, i);

        const nameById = new Map();
        for (const msg of msgs) {
            if (msg.from && !nameById.has(msg.fromId)) nameById.set(msg.fromId, msg.from);
        }
        const idByName = new Map();
        for (const [id, name] of nameById) {
            if (!idByName.has(name)) idByName.set(name, id);
        }

        const users = Array.from(userCounts, ([id, count]) => ({
            id, name: nameById.get(id) || id, count,
        })).sort((a, b) => b.count - a.count);

        if (tzOffset === null) tzOffset = 0;

        const chat = {
            msgs, idIndex, nameById, idByName, users,
            tzOffset,
            chatName: raw.name || '',
            chatType: raw.type || '',
            sourceChars: Number.isFinite(Number(sourceChars)) ? Number(sourceChars) : 0,
        };

        const meta = {
            chatName: chat.chatName,
            chatType: chat.chatType,
            total: msgs.length,
            users,
            minTs,
            maxTs,
            tzOffset,
            sourceChars: chat.sourceChars,
            skippedNoTs,
        };

        return { chat, meta };
    }

    // ══════════════════════════════════════════
    // «НАСТЕННОЕ» ВРЕМЯ ЭКСПОРТЁРА (без Date-магии и таймзон машины)
    // ══════════════════════════════════════════
    function makeWallClock(chat) {
        const { tzOffset } = chat;
        const dayCache = new Map(); // индекс суток → 'YYYY-MM-DD'

        function wallDay(ts) {
            const dayIdx = Math.floor((ts + tzOffset) / DAY_SEC);
            let s = dayCache.get(dayIdx);
            if (!s) {
                const d = new Date(dayIdx * DAY_SEC * 1000); // getUTC* на сдвинутой эпохе = настенное время
                s = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
                dayCache.set(dayIdx, s);
            }
            return s;
        }

        function wallTime(ts) {
            let sod = Math.floor(ts + tzOffset) % DAY_SEC;
            if (sod < 0) sod += DAY_SEC;
            return `${pad2(Math.floor(sod / 3600))}:${pad2(Math.floor((sod % 3600) / 60))}`;
        }

        return { wallDay, wallTime };
    }

    // ══════════════════════════════════════════
    // НОРМАЛИЗАЦИЯ КОНФИГА (защита от NaN/мусора из UI)
    // ══════════════════════════════════════════
    function normalizeConfig(cfg) {
        cfg = cfg || {};
        const mode = MODES.includes(cfg.mode) ? cfg.mode : 'all';
        const windowMinutes = clampInt(cfg.windowMinutes, 30, 0, 10080);
        const dateFromTs = Number.isFinite(Number(cfg.dateFromTs)) ? Number(cfg.dateFromTs) : -Infinity;
        const dateToTs = Number.isFinite(Number(cfg.dateToTs)) ? Number(cfg.dateToTs) : Infinity;
        return {
            mode,
            windowSeconds: windowMinutes * 60,
            dateFromTs,
            dateToTs,
            selectedUsers: Array.isArray(cfg.selectedUsers) ? cfg.selectedUsers : [],
            hideLinks: !!cfg.hideLinks,
            mergeAlbums: !!cfg.mergeAlbums,
            groupRepeats: !!cfg.groupRepeats,
            flattenNewlines: !!cfg.flattenNewlines,
            omitSingleAuthor: !!cfg.omitSingleAuthor,
            showReply: !!cfg.showReply,
            showForwards: !!cfg.showForwards && !cfg.stripForwards,
            showService: !!cfg.showService,
            anonymize: !!cfg.anonymize,
            stripEmoji: !!cfg.stripEmoji,
            stripStickers: !!cfg.stripStickers,
            stripMediaNoText: !!cfg.stripMediaNoText,
            stripForwards: !!cfg.stripForwards,
            stripShort: !!cfg.stripShort,
            shortLen: clampInt(cfg.shortLen, 3, 1, 200),
        };
    }

    // ══════════════════════════════════════════
    // СЖАТИЕ
    // ══════════════════════════════════════════
    function minify(chat, rawCfg) {
        const cfg = normalizeConfig(rawCfg);
        const { msgs, idIndex, idByName } = chat;
        const { wallDay, wallTime } = makeWallClock(chat);

        if (cfg.dateFromTs > cfg.dateToTs) {
            throw new Error('Дата "С" позже даты "По"');
        }

        // ── границы диапазона дат (msgs отсортированы по ts) ──
        let lo = 0;
        let hi = msgs.length;
        if (Number.isFinite(cfg.dateFromTs)) {
            let l = 0, r = msgs.length;
            while (l < r) { const mid = (l + r) >>> 1; if (msgs[mid].ts < cfg.dateFromTs) l = mid + 1; else r = mid; }
            lo = l;
        }
        if (Number.isFinite(cfg.dateToTs)) {
            let l = lo, r = msgs.length;
            while (l < r) { const mid = (l + r) >>> 1; if (msgs[mid].ts <= cfg.dateToTs) l = mid + 1; else r = mid; }
            hi = l;
        }

        // ── маска оставляемых сообщений по режиму выборки ──
        const targets = new Set(cfg.selectedUsers);
        let keep = null;

        if (cfg.mode === 'only') {
            keep = new Uint8Array(msgs.length);
            for (let i = lo; i < hi; i++) {
                if (msgs[i].type === 'message' && targets.has(msgs[i].fromId)) keep[i] = 1;
            }
        } else if (cfg.mode === 'window') {
            keep = new Uint8Array(msgs.length);
            const targetTs = [];
            for (let i = lo; i < hi; i++) {
                if (msgs[i].type === 'message' && targets.has(msgs[i].fromId)) targetTs.push(msgs[i].ts);
            }
            // сливаем пересекающиеся интервалы, затем отмечаем всё внутри них
            if (targetTs.length > 0) {
                const intervals = [];
                let cs = targetTs[0] - cfg.windowSeconds, ce = targetTs[0] + cfg.windowSeconds;
                for (let i = 1; i < targetTs.length; i++) {
                    const ns = targetTs[i] - cfg.windowSeconds, ne = targetTs[i] + cfg.windowSeconds;
                    if (ns <= ce) { ce = Math.max(ce, ne); }
                    else { intervals.push(cs, ce); cs = ns; ce = ne; }
                }
                intervals.push(cs, ce);
                for (let j = 0; j < intervals.length; j += 2) {
                    let il = lo, ir = hi;
                    { let l = lo, r = hi; while (l < r) { const mid = (l + r) >>> 1; if (msgs[mid].ts < intervals[j]) l = mid + 1; else r = mid; } il = l; }
                    { let l = il, r = hi; while (l < r) { const mid = (l + r) >>> 1; if (msgs[mid].ts <= intervals[j + 1]) l = mid + 1; else r = mid; } ir = l; }
                    for (let i = il; i < ir; i++) keep[i] = 1;
                }
            }
        } else if (cfg.mode === 'replies') {
            keep = new Uint8Array(msgs.length);
            const targetIds = new Set();
            for (let i = lo; i < hi; i++) {
                const m = msgs[i];
                if (m.type === 'message' && targets.has(m.fromId)) {
                    keep[i] = 1;
                    targetIds.add(m.id);
                    if (m.reply) {
                        const ri = idIndex.get(m.reply);
                        if (ri !== undefined) keep[ri] = 1; // контекст может лежать вне диапазона дат — это ок
                    }
                }
            }
            for (let i = lo; i < hi; i++) {
                if (msgs[i].reply && targetIds.has(msgs[i].reply)) keep[i] = 1;
            }
        }

        // ── «скрыть автора», если после фильтров он всего один ──
        let shouldOmitAuthor = false;
        if (cfg.omitSingleAuthor) {
            const seen = new Set();
            for (let i = lo; i < hi; i++) {
                if (keep && !keep[i]) continue;
                const m = msgs[i];
                if (m.type === 'message' && m.from) {
                    seen.add(m.fromId || m.from);
                    if (seen.size > 1) break;
                }
            }
            shouldOmitAuthor = seen.size <= 1;
        }

        // ── анонимизация: по-ID для участников, по-имени для внешних fwd ──
        const anonById = new Map();
        let anonCounter = 0;
        const aliasOf = (key) => {
            if (!anonById.has(key)) anonById.set(key, 'User' + (++anonCounter));
            return anonById.get(key);
        };
        const memberName = (m) => {
            if (!m.from || shouldOmitAuthor) return '';
            return cfg.anonymize ? aliasOf(m.fromId || m.from) : m.from;
        };
        const fwdNameOf = (name) => {
            if (!name) return '';
            if (!cfg.anonymize) return name;
            return aliasOf(idByName.get(name) || 'name:' + name);
        };
        const serviceActorOf = (m) => {
            if (!m.actor) return '';
            if (!cfg.anonymize) return m.actor;
            return aliasOf(m.actorId || idByName.get(m.actor) || 'name:' + m.actor);
        };

        // ── сборка вывода ──
        const lines = [];
        let lastDay = '';
        let lastAuthor = '';
        let buf = null;

        function emitDay(ts) {
            const day = wallDay(ts);
            if (day === lastDay) return;
            flush(); // сначала допечатываем буфер ПРЕДЫДУЩЕГО дня — иначе сообщение уедет под чужой заголовок
            if (lines.length) lines.push('');
            lines.push(`[${day}]`);
            lastDay = day;
            lastAuthor = '';
        }

        function flush() {
            if (!buf) return;
            const b = buf;
            buf = null; // сброс ДО раннего выхода: «залипший» буфер больше невозможен

            const parts = [];
            if (b.fwd && cfg.showForwards) parts.push(b.fwdName ? `[fwd ${b.fwdName}]` : '[fwd]');
            if (b.isReply && cfg.showReply) parts.push('>');

            if (b.mediaList.length) {
                const counts = new Map();
                for (const t of b.mediaList) counts.set(t, (counts.get(t) || 0) + 1);
                const mediaStr = Array.from(counts, ([t, n]) => n > 1 ? t.replace(/]$/, ` x${n}]`) : t).join(' ');
                parts.push(mediaStr);
            }

            let textStr = b.texts.filter(Boolean).join(' · ');
            if (cfg.flattenNewlines) textStr = textStr.replace(/\n{2,}/g, '\n');
            if (textStr) parts.push(textStr);

            if (!parts.length) return;

            let body = parts.join(' ');
            if (b.count > 1) body += ` (x${b.count})`;

            const timeStr = wallTime(b.ts);
            if (!b.author) {
                lines.push(`${timeStr} ${body}`);
            } else if (b.author === lastAuthor) {
                lines.push(`${timeStr}  ${body}`);
            } else {
                lines.push(`${timeStr} ${b.author}: ${body}`);
                lastAuthor = b.author;
            }
        }

        for (let i = lo; i < hi; i++) {
            if (keep && !keep[i]) continue;
            const m = msgs[i];

            // ── сервисные сообщения ──
            if (m.type === 'service') {
                if (!cfg.showService) continue;
                flush();
                emitDay(m.ts);
                lines.push(`${wallTime(m.ts)} ${describeService(m, serviceActorOf(m))}`);
                lastAuthor = '';
                continue;
            }
            if (m.type !== 'message') continue;

            // ── текст с учётом маскировки ссылок ──
            let txt = m.text;
            if (cfg.hideLinks && m.segs) {
                txt = m.segs.map((s) => (s.link ? '[URL]' : s.t)).join('');
            }
            // сообщение, состоящее только из ссылок, при скрытии ссылок не несёт текста
            if (cfg.hideLinks && txt && /^\s*(?:\[URL\]\s*)+$/.test(txt)) txt = '';
            const trimmed = txt.trim();
            const hasText = trimmed.length > 0;

            // ── фильтры удаления ──
            if (cfg.stripForwards && m.fwd) continue;
            if (cfg.stripStickers && m.isSticker) continue;
            if (cfg.stripMediaNoText && m.media && !hasText) continue;
            if (cfg.stripEmoji && !m.media && hasText && isEmojiOnly(trimmed)) continue;
            if (cfg.stripShort && !m.media && hasText && trimmed.length < cfg.shortLen) continue;

            // полностью пустое сообщение не должно даже открывать секцию дня
            if (!m.media && !hasText) continue;

            emitDay(m.ts);

            const author = memberName(m);
            const authorKey = m.fromId || m.from;
            const isReply = !!m.reply;

            // ── склейка альбомов: медиа подряд от того же автора без текста ──
            if (
                cfg.mergeAlbums && buf &&
                buf.authorKey === authorKey && buf.isReply === isReply && !buf.fwd && !m.fwd &&
                buf.mediaList.length > 0 && buf.texts.length === 0 &&
                m.media && !hasText &&
                m.ts - buf.lastTs <= ALBUM_GAP_SEC
            ) {
                buf.mediaList.push(m.media);
                buf.lastTs = m.ts;
                continue;
            }

            // ── группировка одинаковых текстовых повторов ──
            if (
                cfg.groupRepeats && buf &&
                buf.authorKey === authorKey && buf.isReply === isReply && !buf.fwd && !m.fwd && !isReply &&
                buf.mediaList.length === 0 && buf.texts.length === 1 && buf.texts[0] === trimmed &&
                m.ts - buf.lastTs <= REPEAT_GAP_SEC
            ) {
                buf.count++;
                buf.lastTs = m.ts;
                continue;
            }

            flush();
            buf = {
                ts: m.ts,
                lastTs: m.ts,
                author,
                authorKey,
                isReply,
                fwd: m.fwd,
                fwdName: fwdNameOf(m.fwd),
                mediaList: m.media ? [m.media] : [],
                texts: trimmed ? [trimmed] : [],
                count: 1,
            };
        }
        flush();

        return lines.join('\n');
    }

    // ══════════════════════════════════════════
    // ОЦЕНКА ТОКЕНОВ (эвристика, ±20%)
    // Пробелы отдельно НЕ считаем — токенайзеры приклеивают их к словам,
    // учёт каждого пробела завышал оценку на ~20-30%.
    // ══════════════════════════════════════════
    function countTokens(text) {
        if (!text) return { chars: 0, tokens: 0 };
        let tokens = 0;

        const cyr = text.match(/[а-яА-ЯёЁ]+/g);
        if (cyr) for (const w of cyr) {
            if (w.length <= 3) tokens += 1;
            else if (w.length <= 7) tokens += 2;
            else if (w.length <= 11) tokens += 3;
            else tokens += Math.ceil(w.length / 4);
        }

        const lat = text.match(/[a-zA-Z]+/g);
        if (lat) for (const w of lat) {
            if (w.length <= 4) tokens += 1;
            else if (w.length <= 9) tokens += 2;
            else tokens += Math.ceil(w.length / 4);
        }

        const nums = text.match(/\d+/g);
        if (nums) for (const n of nums) tokens += Math.ceil(n.length / 3);

        const emoji = text.match(/\p{Extended_Pictographic}(\u{FE0F}|\u{200D}\p{Extended_Pictographic})*/gu);
        if (emoji) tokens += emoji.length;

        const punct = text.match(/[^\w\s\u0400-\u04FF]/gu);
        if (punct) tokens += punct.length * 0.5;

        const newlines = text.match(/\n/g);
        if (newlines) tokens += newlines.length;

        return { chars: text.length, tokens: Math.max(1, Math.round(tokens)) };
    }

    // ══════════════════════════════════════════
    // WORKER-ОБВЯЗКА
    // ══════════════════════════════════════════
    let chatData = null;
    let busy = false;

    self.onmessage = async ({ data }) => {
        if (busy) {
            self.postMessage({ type: 'error', text: 'Обработчик занят — дождитесь завершения текущей операции.' });
            return;
        }
        try {
            if (data.type === 'load') {
                busy = true;
                await loadFile(data.file);
                busy = false;
            } else if (data.type === 'process') {
                busy = true;
                processChat(data.config);
                busy = false;
            }
        } catch (err) {
            busy = false;
            self.postMessage({ type: 'error', text: err && err.message ? err.message : String(err) });
        }
    };

    /** Чтение файла с РЕАЛЬНЫМ прогрессом (стримингово), с фолбэком на file.text(). */
    async function readFileWithProgress(file, onPct) {
        if (typeof file.stream === 'function' && file.size > 0) {
            const reader = file.stream().getReader();
            const chunks = [];
            let received = 0;
            let lastPct = -1;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                const pct = Math.min(READ_PROGRESS_MAX, Math.floor((received / file.size) * READ_PROGRESS_MAX));
                if (pct !== lastPct) { lastPct = pct; onPct(pct); }
            }
            return await new Blob(chunks).text();
        }
        onPct(Math.floor(READ_PROGRESS_MAX / 2));
        return await file.text();
    }

    async function loadFile(file) {
        self.postMessage({ type: 'progress', phase: 'read', pct: 0 });
        let text = await readFileWithProgress(file, (pct) =>
            self.postMessage({ type: 'progress', phase: 'read', pct }));

        self.postMessage({ type: 'progress', phase: 'parse', pct: PARSE_PROGRESS });
        let raw;
        try { raw = JSON.parse(text); } catch (e) {
            throw new Error('Невалидный JSON: ' + (e && e.message ? e.message : e));
        }

        self.postMessage({ type: 'progress', phase: 'index', pct: INDEX_PROGRESS });
        const sourceChars = text.length;
        text = null; // освобождаем строку до построения индекса

        const { chat, meta } = loadChat(raw, sourceChars);
        raw = null;
        chatData = chat;

        self.postMessage({ type: 'progress', phase: 'done', pct: 100 });
        self.postMessage({ type: 'loaded', meta });
    }

    function processChat(rawCfg) {
        if (!chatData) throw new Error('Сначала загрузите файл');
        const result = minify(chatData, rawCfg);
        self.postMessage({ type: 'result', text: result });
    }

    // ══════════════════════════════════════════
    // API ДЛЯ ТЕСТОВ И ГЛАВНОГО ПОТОКА
    // ══════════════════════════════════════════
    self.__tgmin = {
        loadChat,
        minify,
        normalizeConfig,
        countTokens,
        formatDuration,
        sanitizeFileName,
        isEmojiOnly,
        clampInt,
    };
    return self.__tgmin;
}

// Доступность в браузере (глобально) и в Node.
if (typeof globalThis !== 'undefined') {
    globalThis.tgminWorkerCore = tgminWorkerCore;
}
