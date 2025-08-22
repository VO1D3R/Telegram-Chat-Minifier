document.addEventListener('DOMContentLoaded', () => {
    const allUI = {
        jsonFile: document.getElementById('jsonFile'), status: document.getElementById('status'), controls: document.getElementById('controls'),
        processBtn: document.getElementById('processBtn'), downloadBtn: document.getElementById('downloadBtn'), userSearch: document.getElementById('userSearch'),
        userList: document.getElementById('userList'), timeWindow: document.getElementById('timeWindow'), modeSelect: document.getElementById('modeSelect'),
        userSelectionGroup: document.getElementById('userSelectionGroup'), outputPreview: document.getElementById('outputPreview'), outputStats: document.getElementById('outputStats'),
        dateFrom: document.getElementById('dateFrom'), dateTo: document.getElementById('dateTo'),
    };
    const options = {
        includeService: document.getElementById('includeService'), showForwards: document.getElementById('showForwards'), showReply: document.getElementById('showReply'),
        hideLinks: document.getElementById('hideLinks'), anonymizeNames: document.getElementById('anonymizeNames'),
    };
    let chatData = null, users = [], selectedUsers = new Set(), lastProcessedText = null;

    allUI.jsonFile.addEventListener('change', handleFileSelect);
    allUI.processBtn.addEventListener('click', processChat);
    allUI.downloadBtn.addEventListener('click', () => { if (lastProcessedText !== null) downloadAsTxt(lastProcessedText); });
    allUI.userSearch.addEventListener('input', renderUserList);
    allUI.modeSelect.addEventListener('change', toggleUserSelectionVisibility);
    [...Object.values(allUI), ...Object.values(options)].forEach(el => {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.type === 'checkbox') {
            el.addEventListener('change', disableDownload);
        }
    });

    function disableDownload() { allUI.downloadBtn.disabled = true; }
    function toggleUserSelectionVisibility() {
        const isUserMode = allUI.modeSelect.value === 'user';
        allUI.userSelectionGroup.style.display = isUserMode ? 'block' : 'none';
        allUI.timeWindow.parentElement.style.display = isUserMode ? 'block' : 'none';
        validateInputs();
    }
    const toLocalISOString = (date) => {
        const pad = (num) => num.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        allUI.status.textContent = 'Чтение файла...';
        allUI.processBtn.disabled = true;
        disableDownload();

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                allUI.status.textContent = 'Парсинг JSON (может занять время)...';
                setTimeout(() => {
                    chatData = JSON.parse(e.target.result);
                    if (!chatData.messages || !Array.isArray(chatData.messages)) throw new Error('Неверный формат файла: отсутствует массив "messages".');
                    chatData.messages = chatData.messages.filter(m => m.date_unixtime).sort((a, b) => parseInt(a.date_unixtime, 10) - parseInt(b.date_unixtime, 10));
                    extractUsers();
                    selectedUsers.clear();
                    renderUserList();
                    setupDateFilters();
                    allUI.status.textContent = `Файл "${chatData.name || 'Chat'}" загружен. Найдено ${users.length} пользователей и ${chatData.messages.length} сообщений.`;
                    allUI.controls.classList.remove('hidden');
                    toggleUserSelectionVisibility();
                }, 50);
            } catch (error) {
                allUI.status.textContent = `Ошибка: ${error.message}`;
                alert(`Не удалось обработать файл.\n\nОшибка: ${error.message}`);
                chatData = null;
            }
        };
        reader.readAsText(file);
    }
    
    function setupDateFilters() {
        if (chatData.messages.length === 0) return;
        const firstMsgDate = new Date(parseInt(chatData.messages[0].date_unixtime, 10) * 1000);
        const lastMsgDate = new Date(parseInt(chatData.messages[chatData.messages.length - 1].date_unixtime, 10) * 1000);
        const minDate = toLocalISOString(firstMsgDate);
        const maxDate = toLocalISOString(lastMsgDate);
        allUI.dateFrom.min = minDate; allUI.dateFrom.max = maxDate; allUI.dateFrom.value = minDate;
        allUI.dateTo.min = minDate; allUI.dateTo.max = maxDate; allUI.dateTo.value = maxDate;
    }

    function extractUsers() {
        const userSet = new Set();
        chatData.messages.forEach(msg => { if (msg.from) userSet.add(msg.from); });
        users = Array.from(userSet).sort((a, b) => a.localeCompare(b));
    }

    function renderUserList() {
        const searchTerm = allUI.userSearch.value.toLowerCase();
        const filteredUsers = users.filter(user => user.toLowerCase().includes(searchTerm));
        allUI.userList.innerHTML = '';
        filteredUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            userItem.textContent = user;
            if (selectedUsers.has(user)) userItem.classList.add('selected');
            userItem.addEventListener('click', () => {
                if (selectedUsers.has(user)) selectedUsers.delete(user);
                else selectedUsers.add(user);
                userItem.classList.toggle('selected');
                validateInputs();
                disableDownload();
            });
            allUI.userList.appendChild(userItem);
        });
    }

    function validateInputs() {
        allUI.processBtn.disabled = !chatData || (allUI.modeSelect.value === 'user' && selectedUsers.size === 0);
    }

    function extractTextFromMessage(message) {
        if (!message.text) return '';
        if (Array.isArray(message.text)) {
            return message.text.map(part => {
                if (typeof part === 'string') return part;
                if (options.hideLinks.checked && (part.type === 'text_link' || part.type === 'url' || part.type === 'mention')) return '[ссылка]';
                return part.text;
            }).join('');
        }
        return message.text || '';
    }

    function getMessageContentSignature(message) {
        if (message.media_type === 'voice_message') return 'voice_message';
        if (message.media_type === 'video_message') return 'video_message';
        if (message.photo) return 'photo';
        if (message.video_file) return 'video';
        if (message.media_type === 'animation') return 'animation';
        if (message.audio_file) return `audio:${message.file_name || 'файл'}`;
        if (message.mime_type?.startsWith('image/')) return 'photo';
        if (message.mime_type?.startsWith('video/')) return 'video';
        if (message.file_name) return `file:${message.file_name}`;
        if (message.sticker_emoji) return `sticker:${message.sticker_emoji}`;
        if (message.media_type === 'sticker') return 'sticker';
        return extractTextFromMessage(message);
    }
    
    function processChat() {
        if (!chatData) return;
        allUI.status.textContent = 'Идет обработка...';
        allUI.outputPreview.value = '';
        allUI.outputStats.textContent = '';
        disableDownload();
        
        setTimeout(() => {
            let messagesToProcess = chatData.messages;
            if (!options.includeService.checked) {
                messagesToProcess = messagesToProcess.filter(m => m.type === 'message');
            }
            const dateFromTs = new Date(allUI.dateFrom.value).getTime() / 1000;
            const dateToTs = new Date(allUI.dateTo.value).getTime() / 1000;
            messagesToProcess = messagesToProcess.filter(m => parseInt(m.date_unixtime, 10) >= dateFromTs && parseInt(m.date_unixtime, 10) <= dateToTs);
            
            let filteredMessages;
            if (allUI.modeSelect.value === 'user') {
                const windowSeconds = parseInt(allUI.timeWindow.value, 10) * 60;
                const targetMessages = messagesToProcess.filter(m => selectedUsers.has(m.from));
                const targetTimestamps = new Set(targetMessages.map(m => parseInt(m.date_unixtime, 10)));
                const idsToKeep = new Set();
                messagesToProcess.forEach(msg => {
                    const msgTimestamp = parseInt(msg.date_unixtime, 10);
                    for (const targetTs of targetTimestamps) {
                        if (Math.abs(msgTimestamp - targetTs) <= windowSeconds) {
                            idsToKeep.add(msg.id);
                            break;
                        }
                    }
                });
                filteredMessages = messagesToProcess.filter(m => idsToKeep.has(m.id));
            } else {
                filteredMessages = messagesToProcess;
            }
            
            const anonymizationMap = new Map();
            if (options.anonymizeNames.checked) {
                let userCounter = 1;
                users.forEach(user => { anonymizationMap.set(user, `User ${userCounter++}`); });
            }

            lastProcessedText = generateTextOutput(filteredMessages, allUI.modeSelect.value, anonymizationMap);
            allUI.outputPreview.value = lastProcessedText;
            const charCount = lastProcessedText.length;
            const tokenCount = Math.round(charCount / 4.5);
            allUI.outputStats.textContent = `Символов: ${charCount} | Примерно токенов: ${tokenCount}`;
            allUI.downloadBtn.disabled = false;
            allUI.status.textContent = `Обработка завершена. Результат можно скачать.`;
        }, 50);
    }
    
    function generateTextOutput(messages, mode, anonymizationMap) {
        if (!messages.length) return "";
        let output = '', lastHeader = null, lastPrintedAuthor = null, lastPrintedFwdSource = null, lastDay = null, buffer = [];

        const formatTimestamp = (dStr, m) => {
            const d = new Date(dStr); const y = d.getFullYear().toString().slice(-2); const mo = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0'); if (m === 'day') return `${day}.${mo}.${y}`;
            const h = d.getHours().toString().padStart(2, '0'); const mi = d.getMinutes().toString().padStart(2, '0'); return `${day}.${mo}.${y} ${h}:${mi}`;
        };

        const getMessageSignature = (msg) => {
            const author = msg.from || 'SYS';
            const forwardSource = (options.showForwards.checked && msg.forwarded_from) ? msg.forwarded_from : '';
            const content = getMessageContentSignature(msg);
            const textContent = extractTextFromMessage(msg);
            const reply = (options.showReply.checked && msg.reply_to_message_id) ? 'r' : '';
            return `${author}|${forwardSource}|${content}|${textContent}|${reply}`;
        };

        const commitBuffer = () => {
            if (buffer.length === 0) return;
            const firstMsg = buffer[0]; const count = buffer.length;
            let author = firstMsg.from || 'SYS';
            if (options.anonymizeNames.checked && firstMsg.from) author = anonymizationMap.get(author) || author;
            let mediaPart = getMessageContentSignature(firstMsg);
            let textPart = extractTextFromMessage(firstMsg);
            
            const mediaMap = {'photo':'[фото]', 'video':'[видео]', 'sticker':'[стикер]', 'voice_message':'[голосовое сообщение]', 'video_message':'[видеосообщение]', 'animation':'[анимация]'};
            let isMedia = false;
            
            if(mediaMap[mediaPart]) { mediaPart = mediaMap[mediaPart]; isMedia = true;
            } else if (mediaPart.startsWith('sticker:')) { mediaPart = mediaPart.substring(8);
            } else if (mediaPart.startsWith('file:')) { mediaPart = `[файл: ${mediaPart.substring(5)}]`; isMedia = true;
            } else if (mediaPart.startsWith('audio:')) { mediaPart = `[аудио: ${mediaPart.substring(6)}]`; isMedia = true;
            } else { textPart = ''; }
            
            let text = isMedia ? `${mediaPart} ${textPart}`.trim() : mediaPart;
            const showAuthor = author !== lastPrintedAuthor;
            let linePrefix = '';
            if (showAuthor) { linePrefix = `${author}:`; lastPrintedAuthor = author; }
            
            if (options.showForwards.checked && firstMsg.forwarded_from) {
                let fwdFrom = firstMsg.forwarded_from;
                if (options.anonymizeNames.checked && users.includes(fwdFrom)) fwdFrom = anonymizationMap.get(fwdFrom) || fwdFrom;
                if (showAuthor || fwdFrom !== lastPrintedFwdSource) text = `[FWD от ${fwdFrom}] ${text}`;
                lastPrintedFwdSource = fwdFrom;
            } else { lastPrintedFwdSource = null; }

            if (options.showReply.checked && firstMsg.reply_to_message_id) text = `> ${text}`;
            
            if (count > 1) {
                if (isMedia && !textPart.trim()) text = `[${text.replace(/\[|\]/g, '')} x${count}]`;
                else text += ` (x${count})`;
            }

            if (text.trim()) output += `${linePrefix}${text.trim()}\n`;
            buffer = [];
        };
        
        for (const msg of messages) {
            const currentDay = msg.date.split('T')[0];
            const currentHeader = (mode === 'user') ? formatTimestamp(msg.date) : formatTimestamp(msg.date, 'day');
            
            if (currentHeader !== lastHeader) {
                commitBuffer(); if (output) output += '\n'; output += `[${currentHeader}]\n`;
                lastHeader = currentHeader; lastPrintedAuthor = null; lastPrintedFwdSource = null;
            }
            if (currentDay !== lastDay) {
                commitBuffer(); lastPrintedAuthor = null; lastPrintedFwdSource = null; lastDay = currentDay;
            }

            const currentSignature = getMessageSignature(msg);
            const lastSignature = buffer.length > 0 ? getMessageSignature(buffer[0]) : null;

            if (currentSignature !== lastSignature) commitBuffer();
            buffer.push(msg);
        }
        commitBuffer();
        return output.trim();
    }

    function downloadAsTxt(text) {
        const chatName = (chatData.name || 'chat')
            .replace(/[^\p{L}\p{N}\s-]/gu, '') 
            .trim()
            .replace(/\s+/g, '_');

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `processed_${chatName}_minified.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});
