// js/app.js
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const $ = id => document.getElementById(id);

    const dom = {
        dropZone: $('dropZone'),
        fileInput: $('fileInput'),
        browseBtn: $('browseBtn'),
        loadProgress: $('loadProgress'),
        loadBar: $('loadBar'),
        loadPct: $('loadPct'),
        statusBar: $('statusBar'),
        statusIcon: $('statusIcon'),
        statusText: $('statusText'),
        chatInfo: $('chatInfo'),
        infoName: $('infoName'),
        infoType: $('infoType'),
        infoCount: $('infoCount'),
        infoUsers: $('infoUsers'),
        infoPeriod: $('infoPeriod'),
        controls: $('mainControls'),
        scopeMode: $('scopeMode'),
        windowField: $('windowField'),
        windowMinutes: $('windowMinutes'),
        dateFrom: $('dateFrom'),
        dateTo: $('dateTo'),
        userPicker: $('userPicker'),
        userSearch: $('userSearch'),
        userList: $('userList'),
        selectedCount: $('selectedCount'),
        processBtn: $('processBtn'),
        processSpinner: $('processSpinner'),
        resultSection: $('resultSection'),
        resultStats: $('resultStats'),
        resultPreview: $('resultPreview'),
        copyBtn: $('copyBtn'),
        downloadBtn: $('downloadBtn'),
        shortLenField: $('shortLenField'),
    };

    const toggleIds = [
        'fHideLinks', 'fMergeAlbums', 'fFlattenNewlines', 'fOmitSingleAuthor',
        'fShowReply', 'fShowForwards', 'fAnonymize', 'fStripEmoji',
        'fStripStickers', 'fStripMediaNoText', 'fStripForwards', 'fStripShort', 'fShortLen'
    ];
    const tog = {};
    toggleIds.forEach(id => tog[id] = $(id));

    let state = {
        meta: null,
        users: [],
        selected: new Set(),
        resultText: null,
        fileName: 'minified.txt',
        chatName: '',
    };

    // ═══════════════════════════════════════
    // PRESETS
    // ═══════════════════════════════════════
    const PRESETS = {
        safe: {
            fHideLinks: false, fMergeAlbums: false, fFlattenNewlines: false,
            fOmitSingleAuthor: false, fShowReply: true, fShowForwards: true,
            fAnonymize: false, fStripEmoji: false, fStripStickers: false,
            fStripMediaNoText: false, fStripForwards: false, fStripShort: false
        },
        balanced: {
            fHideLinks: true, fMergeAlbums: true, fFlattenNewlines: true,
            fOmitSingleAuthor: true, fShowReply: true, fShowForwards: false,
            fAnonymize: false, fStripEmoji: false, fStripStickers: false,
            fStripMediaNoText: true, fStripForwards: false, fStripShort: false
        },
        aggressive: {
            fHideLinks: true, fMergeAlbums: true, fFlattenNewlines: true,
            fOmitSingleAuthor: true, fShowReply: true, fShowForwards: false,
            fAnonymize: false, fStripEmoji: true, fStripStickers: true,
            fStripMediaNoText: true, fStripForwards: true, fStripShort: true
        }
    };

    function applyPreset(name) {
        const p = PRESETS[name];
        if (!p) return;
        for (const [k, v] of Object.entries(p)) {
            if (tog[k] && tog[k].type === 'checkbox') tog[k].checked = v;
        }
        document.querySelectorAll('.preset').forEach(el => {
            el.classList.toggle('active', el.dataset.preset === name);
        });
        dom.shortLenField.style.display = tog.fStripShort.checked ? 'flex' : 'none';
    }

    document.querySelectorAll('.preset').forEach(el => {
        el.addEventListener('click', () => applyPreset(el.dataset.preset));
    });

    // ═══════════════════════════════════════
    // WEB WORKER
    // ═══════════════════════════════════════
    const WORKER_CODE = `
'use strict';

let chatData = null;

self.onmessage = async ({ data }) => {
    try {
        if (data.type === 'load') await loadFile(data.file);
        if (data.type === 'process') processChat(data.config);
    } catch (err) {
        self.postMessage({ type: 'error', text: err.message || String(err) });
    }
};

async function loadFile(file) {
    self.postMessage({ type: 'progress', phase: 'read', pct: 0 });

    const text = await file.text();
    self.postMessage({ type: 'progress', phase: 'parse', pct: 40 });

    let raw;
    try { raw = JSON.parse(text); }
    catch (e) { throw new Error('Невалидный JSON: ' + e.message); }

    if (!raw.messages || !Array.isArray(raw.messages)) {
        throw new Error('Файл не содержит массив messages');
    }

    self.postMessage({ type: 'progress', phase: 'index', pct: 60 });

    const chatName = raw.name || '';
    const chatType = raw.type || '';
    const msgs = [];
    const userCounts = new Map();
    let minTs = Infinity, maxTs = -Infinity;

    for (let i = 0; i < raw.messages.length; i++) {
        const m = raw.messages[i];
        if (!m.date_unixtime) continue;

        const ts = Number(m.date_unixtime);
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;

        if (m.type === 'message' && m.from) {
            userCounts.set(m.from, (userCounts.get(m.from) || 0) + 1);
        }

        let plain = '', masked = '';
        if (Array.isArray(m.text)) {
            for (const part of m.text) {
                if (typeof part === 'string') {
                    plain += part;
                    masked += part;
                } else {
                    const t = part.text || '';
                    plain += t;
                    if (['link', 'url', 'text_link', 'mention'].includes(part.type)) {
                        masked += '[URL]';
                    } else {
                        masked += t;
                    }
                }
            }
        } else {
            plain = m.text || '';
            masked = plain;
        }

        let media = '';
        let isSticker = false;
        let stickerEmoji = '';

        if (m.media_type === 'sticker' || m.sticker_emoji) {
            media = '[стикер]';
            isSticker = true;
            stickerEmoji = m.sticker_emoji || '';
        } else if (m.photo) {
            media = '[фото]';
        } else if (m.media_type === 'voice_message') {
            media = '[гс]';
        } else if (m.media_type === 'video_message') {
            media = '[кружок]';
        } else if (m.media_type === 'animation') {
            media = '[gif]';
        } else if (m.media_type === 'video_file' || m.video_file) {
            media = '[видео]';
        } else if (m.audio_file) {
            media = '[аудио]';
        } else if (m.file && !m.media_type) {
            media = '[файл]';
        }

        msgs.push({
            id: m.id, ts, type: m.type || 'message',
            from: m.from || '', reply: m.reply_to_message_id || 0,
            fwd: m.forwarded_from || '',
            text: plain, masked, media,
            isSticker, stickerEmoji
        });
    }

    raw = null;
    msgs.sort((a, b) => a.ts - b.ts);

    const idIndex = new Map();
    for (let i = 0; i < msgs.length; i++) {
        idIndex.set(msgs[i].id, i);
    }

    const users = Array.from(userCounts, ([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    const isChannel = users.length <= 1;

    chatData = { msgs, users, idIndex, isChannel, chatName, chatType };

    self.postMessage({ type: 'progress', phase: 'done', pct: 100 });
    self.postMessage({
        type: 'loaded',
        meta: { chatName, chatType, isChannel, total: msgs.length, users, minTs, maxTs }
    });
}

function processChat(cfg) {
    const { msgs, idIndex, isChannel } = chatData;
    const {
        mode, windowSeconds, dateFromTs, dateToTs, selectedUsers,
        hideLinks, mergeAlbums, flattenNewlines, omitSingleAuthor,
        showReply, showForwards, anonymize, stripEmoji, stripStickers,
        stripMediaNoText, stripForwards, stripShort, shortLen
    } = cfg;

    const targets = new Set(selectedUsers);

    // Binary search for date range
    let lo = 0, hi = msgs.length;
    {
        let l = 0, r = msgs.length;
        while (l < r) { const m = (l + r) >>> 1; if (msgs[m].ts < dateFromTs) l = m + 1; else r = m; }
        lo = l;
    }
    {
        let l = lo, r = msgs.length;
        while (l < r) { const m = (l + r) >>> 1; if (msgs[m].ts <= dateToTs) l = m + 1; else r = m; }
        hi = l;
    }

    // Scope filter
    let keep;

    if (mode === 'all') {
        keep = null;
    } else if (mode === 'only') {
        keep = new Uint8Array(msgs.length);
        for (let i = lo; i < hi; i++) {
            if (msgs[i].type === 'message' && targets.has(msgs[i].from)) keep[i] = 1;
        }
    } else if (mode === 'window') {
        const targetTs = [];
        for (let i = lo; i < hi; i++) {
            if (msgs[i].type === 'message' && targets.has(msgs[i].from)) targetTs.push(msgs[i].ts);
        }
        keep = new Uint8Array(msgs.length);
        if (targetTs.length > 0) {
            const intervals = [];
            let cs = targetTs[0] - windowSeconds, ce = targetTs[0] + windowSeconds;
            for (let i = 1; i < targetTs.length; i++) {
                const ns = targetTs[i] - windowSeconds, ne = targetTs[i] + windowSeconds;
                if (ns <= ce) { ce = Math.max(ce, ne); }
                else { intervals.push(cs, ce); cs = ns; ce = ne; }
            }
            intervals.push(cs, ce);
            for (let j = 0; j < intervals.length; j += 2) {
                let il, ir;
                { let l = lo, r = hi;
                  while (l < r) { const m = (l + r) >>> 1; if (msgs[m].ts < intervals[j]) l = m + 1; else r = m; }
                  il = l; }
                { let l = il, r = hi;
                  while (l < r) { const m = (l + r) >>> 1; if (msgs[m].ts <= intervals[j+1]) l = m + 1; else r = m; }
                  ir = l; }
                for (let i = il; i < ir; i++) keep[i] = 1;
            }
        }
    } else if (mode === 'replies') {
        keep = new Uint8Array(msgs.length);
        const targetMsgIds = new Set();
        for (let i = lo; i < hi; i++) {
            if (msgs[i].type === 'message' && targets.has(msgs[i].from)) {
                keep[i] = 1;
                targetMsgIds.add(msgs[i].id);
                if (msgs[i].reply) {
                    const replyIdx = idIndex.get(msgs[i].reply);
                    if (replyIdx !== undefined) keep[replyIdx] = 1;
                }
            }
        }
        for (let i = lo; i < hi; i++) {
            if (msgs[i].reply && targetMsgIds.has(msgs[i].reply)) keep[i] = 1;
        }
    }

    // Anonymization
    const anonMap = new Map();
    let anonCounter = 1;
    const getName = (name) => {
        if (!name) return '';
        if (!anonymize) return name;
        if (!anonMap.has(name)) anonMap.set(name, 'User' + (anonCounter++));
        return anonMap.get(name);
    };

    const shouldOmitAuthor = omitSingleAuthor && isChannel;

    // Build output
    const lines = [];
    let lastDate = '';
    let lastAuthor = '';
    let buf = null;

    const isEmojiOnly = (text) => {
        if (!text || !text.trim()) return false;
        const stripped = text.trim();
        const withoutEmoji = stripped.replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\u{FE0F}\\u{200D}\\s]/gu, '');
        return withoutEmoji.length === 0 && stripped.length <= 40;
    };

    const flush = () => {
        if (!buf) return;
        const parts = [];

        if (buf.fwd && showForwards) parts.push('[fwd]');
        if (buf.isReply && showReply) parts.push('>');

        if (mergeAlbums && buf.mediaList.length > 1) {
            const counts = {};
            for (const m of buf.mediaList) counts[m] = (counts[m] || 0) + 1;
            const mediaStr = Object.entries(counts)
                .map(([k, v]) => v > 1 ? k.replace(/]$/, ' x' + v + ']') : k)
                .join(' ');
            parts.push(mediaStr);
        } else if (buf.mediaList.length === 1) {
            parts.push(buf.mediaList[0]);
        }

        let textStr = buf.texts.filter(Boolean).join(' · ');

        // Flatten newlines: collapse 2+ consecutive newlines into single newline.
        // Single newlines are preserved (they represent paragraph breaks within a message).
        if (flattenNewlines) {
            textStr = textStr.replace(/\\n{2,}/g, '\\n');
        }

        if (textStr) parts.push(textStr);
        if (parts.length === 0) return;

        const body = parts.join(' ');
        const timeStr = formatTime(buf.ts);

        if (shouldOmitAuthor) {
            lines.push(timeStr + ' ' + body);
        } else if (buf.author === lastAuthor) {
            lines.push(timeStr + '  ' + body);
        } else {
            lines.push(timeStr + ' ' + buf.author + ': ' + body);
            lastAuthor = buf.author;
        }

        buf = null;
    };

    const formatTime = (ts) => {
        const d = new Date(ts * 1000);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    const formatDateHeader = (ts) => {
        const d = new Date(ts * 1000);
        return String(d.getDate()).padStart(2, '0') + '.' +
               String(d.getMonth() + 1).padStart(2, '0') + '.' +
               String(d.getFullYear()).slice(-2);
    };

    for (let i = lo; i < hi; i++) {
        if (keep && !keep[i]) continue;
        const m = msgs[i];
        if (m.type !== 'message') continue;

        const txt = hideLinks ? m.masked : m.text;
        const hasText = txt.trim().length > 0;

        // Per-message filters
        if (stripForwards && m.fwd) continue;
        if (stripStickers && m.isSticker) continue;
        if (stripMediaNoText && m.media && !m.isSticker && !hasText) continue;
        if (stripEmoji && !m.media && hasText && isEmojiOnly(txt)) continue;
        if (stripShort && !m.media && hasText && txt.trim().length < shortLen) continue;

        // Date headers
        const dateStr = formatDateHeader(m.ts);
        if (dateStr !== lastDate) {
            flush();
            if (lines.length > 0) lines.push('');
            lines.push('[' + dateStr + ']');
            lastDate = dateStr;
            lastAuthor = '';
        }

        const author = getName(m.from);
        const isReply = !!m.reply;

        let displayMedia = m.media;
        if (m.isSticker && m.stickerEmoji && !stripStickers) {
            displayMedia = '[' + m.stickerEmoji + ']';
        }

        // Album merging
        if (mergeAlbums && buf && buf.author === author && buf.ts === m.ts && buf.isReply === isReply) {
            if (displayMedia) buf.mediaList.push(displayMedia);
            const t = txt.trim();
            if (t && !buf.texts.includes(t)) buf.texts.push(t);
            continue;
        }

        flush();
        buf = {
            ts: m.ts, author, isReply,
            fwd: m.fwd,
            mediaList: displayMedia ? [displayMedia] : [],
            texts: txt.trim() ? [txt.trim()] : []
        };
    }
    flush();

    const result = lines.join('\\n').trim();
    self.postMessage({ type: 'result', text: result });
}
`;

    const workerBlob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(workerBlob));

    // ═══════════════════════════════════════
    // WORKER MESSAGES
    // ═══════════════════════════════════════
    worker.onmessage = ({ data }) => {
        switch (data.type) {
            case 'progress':
                showLoadProgress(true, data.pct,
                    data.phase === 'read' ? 'Чтение файла…' :
                    data.phase === 'parse' ? 'Парсинг JSON…' :
                    data.phase === 'index' ? 'Индексация…' : 'Готово');
                break;
            case 'loaded':
                showLoadProgress(false);
                state.meta = data.meta;
                state.users = data.meta.users;
                state.chatName = data.meta.chatName;
                state.selected.clear();
                displayChatInfo(data.meta);
                setupDateRange(data.meta.minTs, data.meta.maxTs);
                renderUsers();
                dom.controls.classList.remove('hidden');
                dom.chatInfo.classList.remove('hidden');
                updateScopeUI();
                validateProcess();
                setStatus('done', `Загружено: ${data.meta.total.toLocaleString()} сообщений`);
                break;
            case 'result':
                onResult(data.text);
                break;
            case 'error':
                setStatus('error', 'Ошибка: ' + data.text);
                dom.processBtn.disabled = false;
                dom.processSpinner.classList.add('hidden');
                showLoadProgress(false);
                break;
        }
    };

    // ═══════════════════════════════════════
    // TOKEN COUNTING
    // ═══════════════════════════════════════
    function countTokensHeuristic(text) {
        if (!text) return { chars: 0, tokens: 0 };
        const len = text.length;
        let tokens = 0;

        const cyrillicWords = text.match(/[а-яА-ЯёЁ]+/g);
        if (cyrillicWords) {
            for (const w of cyrillicWords) {
                if (w.length <= 3) tokens += 1;
                else if (w.length <= 6) tokens += 2;
                else if (w.length <= 10) tokens += 3;
                else tokens += Math.ceil(w.length / 3.5);
            }
        }

        const latinWords = text.match(/[a-zA-Z]+/g);
        if (latinWords) {
            for (const w of latinWords) {
                if (w.length <= 5) tokens += 1;
                else if (w.length <= 10) tokens += 2;
                else tokens += Math.ceil(w.length / 5);
            }
        }

        const numbers = text.match(/\d+/g);
        if (numbers) {
            for (const n of numbers) tokens += Math.ceil(n.length / 3);
        }

        const emoji = text.match(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{2700}-\u{27BF}]/gu);
        if (emoji) tokens += emoji.length * 2;

        const spaces = text.match(/\s+/g);
        if (spaces) {
            for (const s of spaces) tokens += Math.ceil(s.length * 0.3);
        }

        const punct = text.match(/[^\w\s\u0400-\u04FF]/gu);
        if (punct) tokens += punct.length * 0.5;

        return { chars: len, tokens: Math.max(1, Math.round(tokens)) };
    }

    // ═══════════════════════════════════════
    // FILE HANDLING
    // ═══════════════════════════════════════
    dom.dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dom.dropZone.classList.add('drag-over');
    });
    dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('drag-over'));
    dom.dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dom.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) loadFile(file);
    });
    dom.dropZone.addEventListener('click', () => dom.fileInput.click());
    dom.browseBtn.addEventListener('click', e => { e.stopPropagation(); dom.fileInput.click(); });
    dom.fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

    function loadFile(file) {
        state.fileName = file.name.replace(/\.json$/i, '') + '_min.txt';
        state.resultText = null;
        dom.controls.classList.add('hidden');
        dom.chatInfo.classList.add('hidden');
        dom.resultSection.classList.add('hidden');
        dom.processBtn.disabled = true;
        setStatus('loading', 'Загрузка ' + file.name + '…');
        showLoadProgress(true, 5, 'Отправка в обработчик…');
        worker.postMessage({ type: 'load', file });
    }

    // ═══════════════════════════════════════
    // CHAT INFO
    // ═══════════════════════════════════════
    function displayChatInfo(meta) {
        dom.infoName.textContent = meta.chatName || '—';
        const typeMap = {
            'public_channel': 'Канал', 'private_channel': 'Канал (приват)',
            'public_supergroup': 'Супергруппа', 'private_supergroup': 'Супергруппа (приват)',
            'personal_chat': 'Личный чат', 'private_group': 'Группа', 'bot_chat': 'Бот',
        };
        dom.infoType.textContent = typeMap[meta.chatType] || meta.chatType || '—';
        dom.infoCount.textContent = meta.total.toLocaleString();
        dom.infoUsers.textContent = meta.users.length.toLocaleString();
        const fmtDate = ts => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
        dom.infoPeriod.textContent = fmtDate(meta.minTs) + ' — ' + fmtDate(meta.maxTs);
    }

    function setupDateRange(minTs, maxTs) {
        const toLocal = ts => {
            const d = new Date(ts * 1000);
            const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
        };
        const minStr = toLocal(minTs), maxStr = toLocal(maxTs);
        dom.dateFrom.min = dom.dateTo.min = minStr;
        dom.dateFrom.max = dom.dateTo.max = maxStr;
        dom.dateFrom.value = minStr;
        dom.dateTo.value = maxStr;
    }

    // ═══════════════════════════════════════
    // USER PICKER
    // ═══════════════════════════════════════
    function renderUsers() {
        const search = dom.userSearch.value.toLowerCase();
        const frag = document.createDocumentFragment();
        let shown = 0;
        for (const u of state.users) {
            if (search && !u.name.toLowerCase().includes(search)) continue;
            if (shown++ >= 150) break;
            const div = document.createElement('div');
            div.className = 'user-item' + (state.selected.has(u.name) ? ' selected' : '');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'user-item__name';
            nameSpan.textContent = u.name;
            const countSpan = document.createElement('span');
            countSpan.className = 'user-item__count';
            countSpan.textContent = u.count.toLocaleString();
            div.appendChild(nameSpan);
            div.appendChild(countSpan);
            div.addEventListener('click', () => {
                if (state.selected.has(u.name)) state.selected.delete(u.name);
                else state.selected.add(u.name);
                div.classList.toggle('selected');
                updateSelectedCount();
                validateProcess();
            });
            frag.appendChild(div);
        }
        dom.userList.innerHTML = '';
        dom.userList.appendChild(frag);
        updateSelectedCount();
    }

    function updateSelectedCount() {
        dom.selectedCount.textContent = state.selected.size > 0 ? `(${state.selected.size})` : '';
    }

    dom.userSearch.addEventListener('input', renderUsers);

    // ═══════════════════════════════════════
    // SCOPE UI
    // ═══════════════════════════════════════
    dom.scopeMode.addEventListener('change', updateScopeUI);

    function updateScopeUI() {
        const mode = dom.scopeMode.value;
        dom.userPicker.classList.toggle('hidden', mode === 'all');
        dom.windowField.classList.toggle('hidden', mode !== 'window');
        validateProcess();
    }

    function validateProcess() {
        const mode = dom.scopeMode.value;
        dom.processBtn.disabled = !state.meta || (mode !== 'all' && state.selected.size === 0);
    }

    tog.fStripShort.addEventListener('change', () => {
        dom.shortLenField.style.display = tog.fStripShort.checked ? 'flex' : 'none';
    });
    dom.shortLenField.style.display = tog.fStripShort.checked ? 'flex' : 'none';

    // ═══════════════════════════════════════
    // PROCESS
    // ═══════════════════════════════════════
    dom.processBtn.addEventListener('click', () => {
        dom.processBtn.disabled = true;
        dom.processSpinner.classList.remove('hidden');
        dom.resultSection.classList.add('hidden');
        setStatus('loading', 'Генерация сжатого текста…');

        worker.postMessage({
            type: 'process',
            config: {
                mode: dom.scopeMode.value,
                windowSeconds: parseInt(dom.windowMinutes.value || '30') * 60,
                dateFromTs: Math.floor(new Date(dom.dateFrom.value).getTime() / 1000),
                dateToTs: Math.floor(new Date(dom.dateTo.value).getTime() / 1000),
                selectedUsers: Array.from(state.selected),
                hideLinks: tog.fHideLinks.checked,
                mergeAlbums: tog.fMergeAlbums.checked,
                flattenNewlines: tog.fFlattenNewlines.checked,
                omitSingleAuthor: tog.fOmitSingleAuthor.checked,
                showReply: tog.fShowReply.checked,
                showForwards: tog.fShowForwards.checked,
                anonymize: tog.fAnonymize.checked,
                stripEmoji: tog.fStripEmoji.checked,
                stripStickers: tog.fStripStickers.checked,
                stripMediaNoText: tog.fStripMediaNoText.checked,
                stripForwards: tog.fStripForwards.checked,
                stripShort: tog.fStripShort.checked,
                shortLen: parseInt(tog.fShortLen.value || '3'),
            }
        });
    });

    // ═══════════════════════════════════════
    // RESULT
    // ═══════════════════════════════════════
    function onResult(text) {
        state.resultText = text;
        dom.processBtn.disabled = false;
        dom.processSpinner.classList.add('hidden');

        if (!text) {
            setStatus('done', 'Результат пуст — ничего не прошло фильтры.');
            return;
        }

        const { chars, tokens } = countTokensHeuristic(text);
        const lineCount = text.split('\n').length;
        const origChars = state.meta ? state.meta.total * 120 : chars * 3;
        const compression = origChars > 0 ? Math.round((1 - chars / origChars) * 100) : 0;

        dom.resultStats.innerHTML = `
            <div class="result__stat">
                <span class="result__stat-label">Символов</span>
                <span class="result__stat-value">${chars.toLocaleString()}</span>
            </div>
            <div class="result__stat">
                <span class="result__stat-label">Токенов ≈</span>
                <span class="result__stat-value result__stat-value--accent">${tokens.toLocaleString()}</span>
            </div>
            <div class="result__stat">
                <span class="result__stat-label">Строк</span>
                <span class="result__stat-value">${lineCount.toLocaleString()}</span>
            </div>
            <div class="result__stat">
                <span class="result__stat-label">Сжатие</span>
                <span class="result__stat-value result__stat-value--success">−${compression}%</span>
            </div>
        `;

        const MAX_PREVIEW = 20000;
        let preview = text;
        if (text.length > MAX_PREVIEW) {
            preview = text.substring(0, MAX_PREVIEW) + '\n\n── обрезано для предпросмотра (' + chars.toLocaleString() + ' символов всего) ──';
        }
        dom.resultPreview.textContent = preview;
        dom.resultSection.classList.remove('hidden');
        setStatus('done', 'Готово. ≈' + tokens.toLocaleString() + ' токенов');
        dom.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ═══════════════════════════════════════
    // COPY & DOWNLOAD
    // ═══════════════════════════════════════
    dom.copyBtn.addEventListener('click', async () => {
        if (!state.resultText) return;
        try {
            await navigator.clipboard.writeText(state.resultText);
            const span = dom.copyBtn.querySelector('span');
            const orig = span.textContent;
            span.textContent = 'Скопировано!';
            setTimeout(() => span.textContent = orig, 2000);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = state.resultText;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    });

    dom.downloadBtn.addEventListener('click', () => {
        if (!state.resultText) return;
        const blob = new Blob([state.resultText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = state.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // ═══════════════════════════════════════
    // UI HELPERS
    // ═══════════════════════════════════════
    function setStatus(type, text) {
        dom.statusBar.classList.remove('hidden', 'status-bar--done');
        if (type === 'done') dom.statusBar.classList.add('status-bar--done');
        dom.statusText.textContent = text;
    }

    function showLoadProgress(show, pct, hint) {
        dom.loadProgress.classList.toggle('hidden', !show);
        if (show) {
            dom.loadBar.style.width = pct + '%';
            dom.loadPct.textContent = Math.round(pct) + '%';
            if (hint) dom.statusText.textContent = hint;
        }
    }

    applyPreset('balanced');
});