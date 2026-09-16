/* ============================================================================
 * js/app.js — интерфейс Telegram Chat Minifier 2.0
 * ----------------------------------------------------------------------------
 * Здесь ТОЛЬКО UI: события, состояние экрана, форматирование статистики.
 * Вся логика сжатия — в js/core.js и выполняется в Web Worker.
 *
 * Воркер создаётся из исходника ядра (toString → Blob), поэтому приложение
 * работает с file:// без сети, сборки и полифиллов.
 * ========================================================================== */
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const dom = {
        dropZone: $('dropZone'), fileInput: $('fileInput'), browseBtn: $('browseBtn'),
        loadProgress: $('loadProgress'), loadBar: $('loadBar'), loadPct: $('loadPct'),
        statusBar: $('statusBar'), statusIcon: $('statusIcon'), statusText: $('statusText'),
        chatInfo: $('chatInfo'), infoName: $('infoName'), infoType: $('infoType'),
        infoCount: $('infoCount'), infoUsers: $('infoUsers'), infoPeriod: $('infoPeriod'),
        controls: $('mainControls'), scopeMode: $('scopeMode'), windowField: $('windowField'),
        windowMinutes: $('windowMinutes'), dateFrom: $('dateFrom'), dateTo: $('dateTo'),
        userPicker: $('userPicker'), userSearch: $('userSearch'), userList: $('userList'),
        selectedCount: $('selectedCount'), processBtn: $('processBtn'), processSpinner: $('processSpinner'),
        resultSection: $('resultSection'), resultStats: $('resultStats'),
        resultPreview: $('resultPreview'), copyBtn: $('copyBtn'), downloadBtn: $('downloadBtn'),
        shortLenField: $('shortLenField'),
    };

    const TOGGLE_IDS = [
        'fHideLinks', 'fMergeAlbums', 'fGroupRepeats', 'fFlattenNewlines', 'fOmitSingleAuthor',
        'fShowReply', 'fShowForwards', 'fShowService', 'fAnonymize', 'fStripEmoji',
        'fStripStickers', 'fStripMediaNoText', 'fStripForwards', 'fStripShort',
    ];
    const tog = {};
    for (const id of TOGGLE_IDS) tog[id] = $(id);
    tog.fShortLen = $('fShortLen');

    const state = {
        meta: null,          // {chatName, chatType, total, users, minTs, maxTs, sourceChars,...}
        selected: new Set(), // fromId выбранных участников
        resultText: null,
        fileName: 'minified.txt',
        busy: false,
    };

    // ── доступ к ядру в главном потоке (для токенов/имен файлов) ──
    const coreBox = {};
    globalThis.tgminWorkerCore(coreBox);
    const core = coreBox.__tgmin;

    // ══════════════════════════════════════════
    // WEB WORKER
    // ══════════════════════════════════════════
    function createWorker() {
        if (typeof globalThis.tgminWorkerCore !== 'function') {
            throw new Error('Ядро не загружено — проверьте, что js/core.js подключён до js/app.js');
        }
        const src = globalThis.tgminWorkerCore.toString() + '\n;tgminWorkerCore(self);';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const worker = new Worker(url);
        // URL больше не нужен, но отзывать сразу нельзя: воркер мог не успеть загрузиться
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return worker;
    }

    const worker = createWorker();

    worker.onerror = (e) => {
        setBusy(false);
        showLoadProgress(false);
        setStatus('error', 'Ошибка воркера: ' + (e.message || 'неизвестная'));
    };

    worker.onmessage = ({ data }) => {
        switch (data.type) {
            case 'progress': {
                const label =
                    data.phase === 'read' ? 'Чтение файла…' :
                    data.phase === 'parse' ? 'Парсинг JSON…' :
                    data.phase === 'index' ? 'Индексация…' : 'Готово';
                showLoadProgress(true, data.pct, label);
                break;
            }
            case 'loaded':
                setBusy(false);
                showLoadProgress(false);
                onLoaded(data.meta);
                break;
            case 'result':
                setBusy(false);
                onResult(data.text);
                break;
            case 'error':
                setBusy(false);
                showLoadProgress(false);
                setStatus('error', 'Ошибка: ' + data.text);
                break;
        }
    };

    // ══════════════════════════════════════════
    // ПРЕСЕТЫ
    // ══════════════════════════════════════════
    const PRESETS = {
        safe: {
            fHideLinks: false, fMergeAlbums: false, fGroupRepeats: false, fFlattenNewlines: false,
            fOmitSingleAuthor: false, fShowReply: true, fShowForwards: true, fShowService: false,
            fAnonymize: false, fStripEmoji: false, fStripStickers: false, fStripMediaNoText: false,
            fStripForwards: false, fStripShort: false,
        },
        balanced: {
            fHideLinks: true, fMergeAlbums: true, fGroupRepeats: false, fFlattenNewlines: true,
            fOmitSingleAuthor: true, fShowReply: true, fShowForwards: true, fShowService: false,
            fAnonymize: false, fStripEmoji: false, fStripStickers: true, fStripMediaNoText: true,
            fStripForwards: false, fStripShort: false,
        },
        aggressive: {
            fHideLinks: true, fMergeAlbums: true, fGroupRepeats: true, fFlattenNewlines: true,
            fOmitSingleAuthor: true, fShowReply: true, fShowForwards: false, fShowService: false,
            fAnonymize: false, fStripEmoji: true, fStripStickers: true, fStripMediaNoText: true,
            fStripForwards: true, fStripShort: true,
        },
    };

    function applyPreset(name) {
        const p = PRESETS[name];
        if (!p) return;
        for (const [k, v] of Object.entries(p)) {
            if (tog[k] && tog[k].type === 'checkbox') tog[k].checked = v;
        }
        document.querySelectorAll('.preset').forEach((el) => {
            el.classList.toggle('active', el.dataset.preset === name);
            el.setAttribute('aria-pressed', String(el.dataset.preset === name));
        });
        syncShortLenField();
        syncForwardConflict();
    }

    // ══════════════════════════════════════════
    // UI-СОСТОЯНИЕ
    // ══════════════════════════════════════════
    function setBusy(v) {
        state.busy = v;
        dom.processSpinner.classList.toggle('hidden', !v);
        validateProcess();
    }

    function setStatus(type, text) {
        dom.statusBar.classList.remove('hidden', 'status-bar--done', 'status-bar--error');
        if (type === 'done') dom.statusBar.classList.add('status-bar--done');
        if (type === 'error') dom.statusBar.classList.add('status-bar--error');
        dom.statusText.textContent = text;
    }

    function showLoadProgress(show, pct, hint) {
        dom.loadProgress.classList.toggle('hidden', !show);
        if (show) {
            dom.loadBar.style.width = pct + '%';
            dom.loadPct.textContent = Math.round(pct) + '%';
            if (hint) setStatus('loading', hint);
        }
    }

    function validateProcess() {
        const mode = dom.scopeMode.value;
        const needUsers = mode !== 'all';
        dom.processBtn.disabled = state.busy || !state.meta || (needUsers && state.selected.size === 0);
    }

    function syncShortLenField() {
        dom.shortLenField.style.display = tog.fStripShort.checked ? 'flex' : 'none';
    }

    // Взаимоисключающие опции: нельзя одновременно показывать и удалять пересылки
    function syncForwardConflict() {
        const strip = tog.fStripForwards.checked;
        tog.fShowForwards.checked = strip ? false : tog.fShowForwards.checked;
        tog.fShowForwards.disabled = strip;
        const wrap = tog.fShowForwards.closest('.toggle');
        if (wrap) wrap.classList.toggle('is-disabled', strip);
    }

    // ══════════════════════════════════════════
    // ЗАГРУЗКА ФАЙЛА
    // ══════════════════════════════════════════
    function isAcceptableFile(file) {
        return /\.(json|txt)$/i.test(file.name) || /json|text/.test(file.type || '');
    }

    function loadFile(file) {
        if (state.busy) {
            setStatus('error', 'Дождитесь завершения текущей обработки.');
            return;
        }
        if (!isAcceptableFile(file)) {
            setStatus('error', `«${file.name}» — не похож на экспорт Telegram (нужен .json или .txt).`);
            return;
        }

        state.meta = null;
        state.selected.clear();
        state.resultText = null;
        dom.controls.classList.add('hidden');
        dom.chatInfo.classList.add('hidden');
        dom.resultSection.classList.add('hidden');
        setStatus('loading', 'Загрузка ' + file.name + '…');
        showLoadProgress(true, 0, 'Чтение файла…');
        setBusy(true);
        worker.postMessage({ type: 'load', file });
    }

    function onLoaded(meta) {
        state.meta = meta;
        document.title = (meta.chatName ? meta.chatName + ' — ' : '') + 'TG Minifier';
        displayChatInfo(meta);
        setupDateRange(meta);
        renderUsers();
        dom.controls.classList.remove('hidden');
        dom.chatInfo.classList.remove('hidden');
        updateScopeUI();
        setStatus('done', `Загружено: ${meta.total.toLocaleString('ru-RU')} сообщений` +
            (meta.skippedNoTs ? ` (без даты пропущено: ${meta.skippedNoTs})` : ''));
    }

    function displayChatInfo(meta) {
        dom.infoName.textContent = meta.chatName || '—';
        const typeMap = {
            public_channel: 'Канал', private_channel: 'Канал (приват)',
            public_supergroup: 'Супергруппа', private_supergroup: 'Супергруппа (приват)',
            personal_chat: 'Личный чат', private_group: 'Группа', bot_chat: 'Бот',
        };
        dom.infoType.textContent = typeMap[meta.chatType] || meta.chatType || '—';
        dom.infoCount.textContent = meta.total.toLocaleString('ru-RU');
        dom.infoUsers.textContent = meta.users.length.toLocaleString('ru-RU');

        // Период печатаем в «настенном» времени экспортёра — без таймзон машины
        const fmt = (ts) => {
            const shift = ts + meta.tzOffset;
            const d = new Date(Math.floor(shift / 86400) * 86400 * 1000);
            return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
        };
        dom.infoPeriod.textContent = fmt(meta.minTs) + ' — ' + fmt(meta.maxTs);
    }

    function setupDateRange(meta) {
        // Границы диапазона — тоже в настенном времени экспортёра (строкой, без Date)
        const dayStr = (ts, next) => {
            const d = new Date((Math.floor((ts + meta.tzOffset) / 86400) + (next ? 1 : 0)) * 86400 * 1000);
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        };
        const minStr = dayStr(meta.minTs, false) + 'T00:00';
        const maxStr = dayStr(meta.maxTs, false) + 'T23:59';
        dom.dateFrom.min = dom.dateTo.min = minStr;
        dom.dateFrom.max = dom.dateTo.max = maxStr;
        dom.dateFrom.value = minStr;
        dom.dateTo.value = maxStr;
    }

    // ══════════════════════════════════════════
    // ВЫБОР УЧАСТНИКОВ (ключ — from_id, а не имя!)
    // ══════════════════════════════════════════
    function renderUsers() {
        const search = dom.userSearch.value.trim().toLowerCase();
        const frag = document.createDocumentFragment();
        const MAX_SHOWN = 300;
        let shown = 0;
        let totalMatched = 0;

        // имена-дубликаты помечаем суффиксом, чтобы их можно было различить
        const dupNames = new Set();
        {
            const seen = new Map();
            for (const u of state.meta.users) {
                const n = seen.get(u.name) || 0;
                if (n === 1) dupNames.add(u.name);
                seen.set(u.name, n + 1);
            }
        }

        for (const u of state.meta.users) {
            if (search && !u.name.toLowerCase().includes(search)) continue;
            totalMatched++;
            if (shown >= MAX_SHOWN) continue;
            shown++;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'user-item' + (state.selected.has(u.id) ? ' selected' : '');
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', String(state.selected.has(u.id)));

            const nameSpan = document.createElement('span');
            nameSpan.className = 'user-item__name';
            nameSpan.textContent = dupNames.has(u.name) ? `${u.name} (${u.id})` : u.name;

            const countSpan = document.createElement('span');
            countSpan.className = 'user-item__count';
            countSpan.textContent = u.count.toLocaleString('ru-RU');

            btn.append(nameSpan, countSpan);
            btn.addEventListener('click', () => {
                if (state.selected.has(u.id)) state.selected.delete(u.id);
                else state.selected.add(u.id);
                btn.classList.toggle('selected');
                btn.setAttribute('aria-selected', String(state.selected.has(u.id)));
                updateSelectedCount();
                validateProcess();
            });
            frag.appendChild(btn);
        }

        dom.userList.innerHTML = '';
        dom.userList.appendChild(frag);

        if (totalMatched > MAX_SHOWN) {
            const note = document.createElement('div');
            note.className = 'user-picker__more';
            note.textContent = `Показаны первые ${MAX_SHOWN} из ${totalMatched} — уточните поиск`;
            dom.userList.appendChild(note);
        }
        updateSelectedCount();
    }

    function updateSelectedCount() {
        dom.selectedCount.textContent = state.selected.size > 0 ? `(${state.selected.size})` : '';
    }

    // ══════════════════════════════════════════
    // ОБРАБОТКА
    // ══════════════════════════════════════════
    function updateScopeUI() {
        const mode = dom.scopeMode.value;
        const needUsers = mode !== 'all';
        dom.userPicker.classList.toggle('hidden', !needUsers || state.meta.users.length === 0);
        dom.windowField.classList.toggle('hidden', mode !== 'window');
        if (needUsers && state.meta.users.length === 0) {
            setStatus('error', 'В этом чате нет сообщений с авторами — доступны режимы «Всё».');
            dom.scopeMode.value = 'all';
            dom.userPicker.classList.add('hidden');
            dom.windowField.classList.add('hidden');
        }
        validateProcess();
    }

    function readConfig() {
        const dateFrom = dom.dateFrom.value || null;
        const dateTo = dom.dateTo.value || null;
        if (dateFrom && dateTo && dateFrom > dateTo) {
            throw new Error('Дата «С» позже даты «По» — исправьте диапазон.');
        }
        return {
            mode: dom.scopeMode.value,
            windowMinutes: dom.windowMinutes.value || '30',
            dateFromStr: dateFrom,
            dateToStr: dateTo,
            selectedUsers: Array.from(state.selected),
            hideLinks: tog.fHideLinks.checked,
            mergeAlbums: tog.fMergeAlbums.checked,
            groupRepeats: tog.fGroupRepeats.checked,
            flattenNewlines: tog.fFlattenNewlines.checked,
            omitSingleAuthor: tog.fOmitSingleAuthor.checked,
            showReply: tog.fShowReply.checked,
            showForwards: tog.fShowForwards.checked,
            showService: tog.fShowService.checked,
            anonymize: tog.fAnonymize.checked,
            stripEmoji: tog.fStripEmoji.checked,
            stripStickers: tog.fStripStickers.checked,
            stripMediaNoText: tog.fStripMediaNoText.checked,
            stripForwards: tog.fStripForwards.checked,
            stripShort: tog.fStripShort.checked,
            shortLen: tog.fShortLen.value || '3',
        };
    }

    function startProcess() {
        let cfg;
        try { cfg = readConfig(); }
        catch (e) { setStatus('error', e.message); return; }

        setBusy(true);
        dom.resultSection.classList.add('hidden');
        setStatus('loading', 'Генерация сжатого текста…');
        worker.postMessage({ type: 'process', config: cfg });
    }

    function onResult(text) {
        state.resultText = text;
        dom.processSpinner.classList.add('hidden');
        state.busy = false;
        validateProcess();

        if (!text) {
            setStatus('done', 'Результат пуст — ничего не прошло фильтры.');
            return;
        }

        const { chars, tokens } = core.countTokens(text);
        const lineCount = text.split('\n').length;
        const srcChars = state.meta ? state.meta.sourceChars : 0;
        const compression = srcChars > 0 ? Math.round((1 - chars / srcChars) * 100) : 0;

        dom.resultStats.innerHTML = `
            <div class="result__stat">
                <span class="result__stat-label">Символов</span>
                <span class="result__stat-value">${chars.toLocaleString('ru-RU')}</span>
            </div>
            <div class="result__stat">
                <span class="result__stat-label">Токенов ≈</span>
                <span class="result__stat-value result__stat-value--accent">${tokens.toLocaleString('ru-RU')}</span>
            </div>
            <div class="result__stat">
                <span class="result__stat-label">Строк</span>
                <span class="result__stat-value">${lineCount.toLocaleString('ru-RU')}</span>
            </div>
            <div class="result__stat" title="Относительно исходного файла: ${srcChars.toLocaleString('ru-RU')} символов">
                <span class="result__stat-label">Сжатие</span>
                <span class="result__stat-value result__stat-value--success">−${compression}%</span>
            </div>
        `;

        const MAX_PREVIEW = 20000;
        let preview = text;
        if (text.length > MAX_PREVIEW) {
            preview = text.slice(0, MAX_PREVIEW) +
                `\n\n── предпросмотр обрезан (всего ${chars.toLocaleString('ru-RU')} символов) ──`;
        }
        dom.resultPreview.textContent = preview;
        dom.resultSection.classList.remove('hidden');
        setStatus('done', `Готово: ${chars.toLocaleString('ru-RU')} симв. (−${compression}% от файла), ≈${tokens.toLocaleString('ru-RU')} токенов`);
        dom.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ══════════════════════════════════════════
    // КОПИРОВАНИЕ И СКАЧИВАНИЕ
    // ══════════════════════════════════════════
    dom.copyBtn.addEventListener('click', async () => {
        if (!state.resultText) return;
        try {
            await navigator.clipboard.writeText(state.resultText);
            flashLabel(dom.copyBtn, 'Скопировано!');
        } catch {
            // fallback для file:// без clipboard-разрешений
            const ta = document.createElement('textarea');
            ta.value = state.resultText;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); flashLabel(dom.copyBtn, 'Скопировано!'); }
            catch { setStatus('error', 'Не удалось скопировать — выделите текст вручную.'); }
            document.body.removeChild(ta);
        }
    });

    function flashLabel(btn, text) {
        const span = btn.querySelector('span');
        const orig = span.textContent;
        span.textContent = text;
        setTimeout(() => { span.textContent = orig; }, 2000);
    }

    dom.downloadBtn.addEventListener('click', () => {
        if (!state.resultText) return;
        const base = core.sanitizeFileName(state.meta && state.meta.chatName) || 'minified';
        const blob = new Blob([state.resultText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${base}_minified.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // ══════════════════════════════════════════
    // ПРИВЯЗКА СОБЫТИЙ
    // ══════════════════════════════════════════
    dom.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.dropZone.classList.add('drag-over');
    });
    dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('drag-over'));
    dom.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    });
    dom.dropZone.addEventListener('click', () => dom.fileInput.click());
    dom.dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.fileInput.click(); }
    });
    dom.browseBtn.addEventListener('click', (e) => { e.stopPropagation(); dom.fileInput.click(); });
    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) loadFile(e.target.files[0]);
        e.target.value = ''; // повторный выбор того же файла тоже срабатывает
    });

    document.querySelectorAll('.preset').forEach((el) => {
        el.addEventListener('click', () => applyPreset(el.dataset.preset));
    });

    dom.scopeMode.addEventListener('change', updateScopeUI);
    dom.userSearch.addEventListener('input', renderUsers);
    tog.fStripShort.addEventListener('change', syncShortLenField);
    tog.fStripForwards.addEventListener('change', syncForwardConflict);
    dom.processBtn.addEventListener('click', startProcess);

    // ══════════════════════════════════════════
    // СТАРТ
    // ══════════════════════════════════════════
    applyPreset('balanced');
    validateProcess();
})();
