document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // ELEMENT SELECTORS
    // ==========================================
    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const matchesBadge = document.getElementById('matches-badge');
    const serverStatusPill = document.getElementById('server-status');
    const statusText = document.getElementById('status-text');

    // Tab 1: Scraper
    const urlInput = document.getElementById('flashscore-url-input');
    const clearUrlBtn = document.getElementById('clear-url-btn');
    const pasteUrlBtn = document.getElementById('paste-url-btn');
    const startScrapeBtn = document.getElementById('start-scrape-btn');
    const btnModeLive = document.getElementById('btn-mode-live');
    const btnModeIeri = document.getElementById('btn-mode-ieri');
    const jobStatusBanner = document.getElementById('job-status-banner');
    const jobTitleText = document.getElementById('job-title-text');
    const jobSubText = document.getElementById('job-sub-text');
    const jobTimer = document.getElementById('job-timer');
    const cancelJobBtn = document.getElementById('cancel-job-btn');

    // Terminal
    const terminalLogs = document.getElementById('terminal-logs');
    const terminalBody = document.getElementById('terminal-body');
    const autoScrollCheck = document.getElementById('auto-scroll-check');
    const copyLogsBtn = document.getElementById('copy-logs-btn');
    const clearTerminalBtn = document.getElementById('clear-terminal-btn');

    // Quick Result Preview
    const quickMatchResult = document.getElementById('quick-match-result');
    const quickCardContainer = document.getElementById('quick-card-container');
    const goToCardsBtn = document.getElementById('go-to-cards-btn');

    // Tab 2: Cards & Filters
    const container = document.getElementById('matches-container');
    const dateDisplay = document.getElementById('date-display');
    const searchInput = document.getElementById('search-input');
    const fileSelector = document.getElementById('file-selector');
    const fileDatePicker = document.getElementById('file-date-picker');
    const dateFilter = document.getElementById('date-filter');
    const timeFilter = document.getElementById('time-filter');
    const campFilter = document.getElementById('camp-filter');
    const refreshBtn = document.getElementById('refresh-btn');
    const statsOverview = document.getElementById('stats-overview');
    const statTotalMatches = document.getElementById('stat-total-matches');
    const statValueBets = document.getElementById('stat-value-bets');
    const statTotalCamps = document.getElementById('stat-total-camps');

    // State
    let allMatches = [];
    let currentJobTimer = null;
    let jobStartTime = null;
    let lastProcessedMatchUrl = null;
    let sseEventSource = null;

    // ==========================================
    // TOAST NOTIFICATIONS
    // ==========================================
    function showToast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let icon = 'fa-info-circle';
        if (type === 'success') icon = 'fa-circle-check';
        if (type === 'error') icon = 'fa-circle-exclamation';

        toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ==========================================
    // TAB SWITCHING
    // ==========================================
    function switchTab(targetTabId) {
        tabBtns.forEach(btn => {
            const isTarget = btn.getAttribute('data-tab') === targetTabId;
            btn.classList.toggle('active', isTarget);
        });

        tabPanes.forEach(pane => {
            const isTarget = pane.id === targetTabId;
            pane.classList.toggle('active', isTarget);
        });

        if (targetTabId === 'tab-cards' && allMatches.length === 0) {
            loadFilesAndMatches();
        }
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');
            switchTab(target);
        });
    });

    // ==========================================
    // TERMINAL CONTROLS & LOGGING
    // ==========================================
    function appendLog(text, level = 'info', timeStr) {
        const line = document.createElement('div');
        line.className = `term-line ${level}`;

        const time = timeStr || new Date().toLocaleTimeString('ro-RO');
        line.innerHTML = `
            <span class="term-time">[${time}]</span>
            <span class="term-msg">${escapeHtml(text)}</span>
        `;

        terminalLogs.appendChild(line);

        if (autoScrollCheck && autoScrollCheck.checked) {
            terminalBody.scrollTop = terminalBody.scrollHeight;
        }
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    clearTerminalBtn.addEventListener('click', () => {
        terminalLogs.innerHTML = `
            <div class="term-line info">
                <span class="term-time">[${new Date().toLocaleTimeString('ro-RO')}]</span>
                <span class="term-msg">Consola a fost golită.</span>
            </div>
        `;
    });

    copyLogsBtn.addEventListener('click', async () => {
        const text = Array.from(terminalLogs.querySelectorAll('.term-line'))
            .map(el => el.innerText)
            .join('\n');
        try {
            await navigator.clipboard.writeText(text);
            showToast('Logurile au fost copiate în clipboard!', 'success');
        } catch (err) {
            showToast('Nu s-au putut copia logurile.', 'error');
        }
    });

    // ==========================================
    // SCRAPER ACTIONS (TAB 1)
    // ==========================================
    urlInput.addEventListener('input', () => {
        clearUrlBtn.style.display = urlInput.value.trim().length > 0 ? 'block' : 'none';
    });

    clearUrlBtn.addEventListener('click', () => {
        urlInput.value = '';
        clearUrlBtn.style.display = 'none';
        urlInput.focus();
    });

    pasteUrlBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                urlInput.value = text.trim();
                clearUrlBtn.style.display = 'block';
                showToast('Link lipit din clipboard!', 'info');
            }
        } catch (err) {
            showToast('Permisiunea pentru clipboard a fost refuzată.', 'error');
        }
    });

    async function startScraping(payload) {
        try {
            startScrapeBtn.disabled = true;
            btnModeLive.disabled = true;
            btnModeIeri.disabled = true;

            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Eroare la pornirea procesului.');
            }

            showToast('Analiza a fost pornită în fundal!', 'info');
            if (payload.url) {
                lastProcessedMatchUrl = payload.url;
            }
            setJobRunningState(true, payload.mode || 'single');

        } catch (err) {
            showToast(err.message, 'error');
            startScrapeBtn.disabled = false;
            btnModeLive.disabled = false;
            btnModeIeri.disabled = false;
        }
    }

    startScrapeBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (!url) {
            showToast('Te rugăm să introduci un link Flashscore!', 'error');
            urlInput.focus();
            return;
        }
        startScraping({ url, mode: 'single' });
    });

    btnModeLive.addEventListener('click', () => {
        if (confirm('Dorești să extragi meciurile care se joacă LIVE acum pe Flashscore?')) {
            startScraping({ mode: 'live' });
        }
    });

    btnModeIeri.addEventListener('click', () => {
        if (confirm('Dorești să actualizezi scorurile finale ale meciurilor de ieri?')) {
            startScraping({ mode: 'ieri' });
        }
    });

    cancelJobBtn.addEventListener('click', async () => {
        if (!confirm('Ești sigur că vrei să oprești analiza în curs?')) return;

        try {
            const res = await fetch('/api/cancel', { method: 'POST' });
            const data = await res.json();
            showToast(data.message || 'Proces oprit.', 'info');
            setJobRunningState(false);
        } catch (err) {
            showToast('Eroare la oprirea procesului.', 'error');
        }
    });

    function setJobRunningState(isRunning, mode = 'single') {
        const dot = serverStatusPill.querySelector('.status-dot');

        if (isRunning) {
            jobStatusBanner.style.display = 'flex';
            dot.classList.add('running');
            statusText.innerText = 'Analiză în curs...';
            startScrapeBtn.disabled = true;
            btnModeLive.disabled = true;
            btnModeIeri.disabled = true;

            let title = 'Analiză meci în desfășurare...';
            if (mode === 'live') title = 'Scraping meciuri LIVE în desfășurare...';
            if (mode === 'ieri') title = 'Actualizare scoruri ieri în desfășurare...';
            jobTitleText.innerText = title;
            jobSubText.innerText = 'Browser Puppeteer activ. Datele sunt procesate rând cu rând.';

            jobStartTime = Date.now();
            updateTimerDisplay();
            clearInterval(currentJobTimer);
            currentJobTimer = setInterval(updateTimerDisplay, 1000);
        } else {
            jobStatusBanner.style.display = 'none';
            dot.classList.remove('running');
            statusText.innerText = 'Server conectat';
            startScrapeBtn.disabled = false;
            btnModeLive.disabled = false;
            btnModeIeri.disabled = false;
            clearInterval(currentJobTimer);
        }
    }

    function updateTimerDisplay() {
        if (!jobStartTime) return;
        const diff = Math.floor((Date.now() - jobStartTime) / 1000);
        const mins = String(Math.floor(diff / 60)).padStart(2, '0');
        const secs = String(diff % 60).padStart(2, '0');
        jobTimer.innerHTML = `<i class="fa-regular fa-clock"></i> ${mins}:${secs}`;
    }

    // ==========================================
    // SERVER-SENT EVENTS (SSE) LISTENER
    // ==========================================
    function initSSE() {
        if (sseEventSource) {
            sseEventSource.close();
        }

        sseEventSource = new EventSource('/api/stream-logs');

        sseEventSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);

                if (data.type === 'status') {
                    if (data.isRunning) {
                        setJobRunningState(true, data.job?.mode || 'single');
                    }
                } else if (data.type === 'log') {
                    appendLog(data.text, data.level, data.time);
                } else if (data.type === 'finished') {
                    setJobRunningState(false);
                    if (data.success) {
                        showToast(`✨ Analiza s-a terminat cu succes (${data.duration}s)!`, 'success');
                        onScrapeFinished();
                    } else {
                        showToast(`⚠️ Procesul s-a încheiat cu codul: ${data.exitCode}`, 'error');
                    }
                } else if (data.type === 'cancelled') {
                    setJobRunningState(false);
                    showToast('Procesul a fost anulat.', 'info');
                }
            } catch (err) {
                console.error('Eroare la parsare SSE:', err);
            }
        };

        sseEventSource.onerror = () => {
            statusText.innerText = 'Reconectare server...';
            const dot = serverStatusPill.querySelector('.status-dot');
            dot.style.background = '#ff3366';
        };

        sseEventSource.onopen = () => {
            statusText.innerText = 'Server conectat';
            const dot = serverStatusPill.querySelector('.status-dot');
            dot.style.background = 'var(--success)';
        };
    }

    async function onScrapeFinished() {
        // Reîncărcăm meciurile din fișier
        await loadFilesAndMatches();

        // Dacă utilizatorul a analizat un meci anume, îl căutăm și îl arătăm ca preview
        if (allMatches && allMatches.length > 0) {
            let targetMatch = null;
            if (lastProcessedMatchUrl) {
                targetMatch = allMatches.find(m => m.urlMeci && m.urlMeci.includes(lastProcessedMatchUrl));
            }
            if (!targetMatch) {
                // Afișăm ultimul meci din fișier
                targetMatch = allMatches[allMatches.length - 1];
            }

            if (targetMatch) {
                renderQuickPreview(targetMatch);
            }
        }
    }

    function renderQuickPreview(match) {
        quickCardContainer.innerHTML = '';
        const card = createMatchCardElement(match);
        quickCardContainer.appendChild(card);
        quickMatchResult.style.display = 'block';

        goToCardsBtn.onclick = () => {
            switchTab('tab-cards');
            setTimeout(() => {
                const matchEl = document.querySelector(`[data-url="${match.urlMeci}"]`);
                if (matchEl) {
                    matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    matchEl.style.boxShadow = '0 0 30px rgba(0, 242, 254, 0.8)';
                    setTimeout(() => matchEl.style.boxShadow = '', 3000);
                }
            }, 300);
        };
    }

    // ==========================================
    // TAB 2: DATA LOADING & MATCH RENDERING
    // ==========================================
    async function loadFilesAndMatches() {
        try {
            const filesRes = await fetch('/api/files');
            const filesData = await filesRes.json();

            fileSelector.innerHTML = '';
            if (filesData.files && filesData.files.length > 0) {
                filesData.files.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.name;
                    const dateFormatted = f.name.replace('statistici_', '').replace('.json', '');
                    opt.textContent = `${f.name} (${f.matchCount} meciuri)`;
                    fileSelector.appendChild(opt);
                });
            } else {
                fileSelector.innerHTML = '<option value="">Niciun fișier disponibil</option>';
            }

            const currentFile = fileSelector.value;
            await loadMatchesFromFile(currentFile);

        } catch (err) {
            console.error('Eroare la citirea fișierelor:', err);
            // Fallback direct
            await loadMatchesFromFile();
        }
    }

    async function loadMatchesFromFile(filename) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Se încarcă meciurile...</p>
            </div>
        `;

        try {
            const url = filename ? `/api/matches?file=${encodeURIComponent(filename)}` : '/api/matches';
            const res = await fetch(url);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Nu s-au putut încărca meciurile.');
            }

            allMatches = data.matches || [];
            matchesBadge.innerText = allMatches.length;

            dateDisplay.innerHTML = `Fișier: <b>${data.filename || 'statistici.json'}</b> (${allMatches.length} meciuri)`;
            
            updateStatsOverview(allMatches);
            populateFilters();
            applyFilters();

        } catch (err) {
            console.error('Eroare:', err);
            container.innerHTML = `
                <div class="no-data">
                    <i class="fa-solid fa-triangle-exclamation fa-3x" style="color: var(--danger); margin-bottom: 1rem;"></i>
                    <h2>Oops! Nu s-au putut încărca datele</h2>
                    <p>${err.message}</p>
                    <button class="btn btn-primary-glow" style="margin: 1.5rem auto 0 auto;" onclick="switchTab('tab-scraper')">
                        <i class="fa-solid fa-bolt"></i> Mergi la Tab 1 și analizează un meci
                    </button>
                </div>
            `;
            updateStatsOverview([]);
        }
    }

    function updateStatsOverview(matches) {
        statsOverview.style.display = 'flex';
        statTotalMatches.innerText = matches.length;

        let valueBetsCount = 0;
        const camps = new Set();

        matches.forEach(m => {
            if (m.campionat) camps.add(m.campionat);
            if (m.predictii) {
                const hasHigh = Object.values(m.predictii).some(v => typeof v === 'number' && v >= 90);
                if (hasHigh) valueBetsCount++;
            }
        });

        statValueBets.innerText = valueBetsCount;
        statTotalCamps.innerText = camps.size;
    }

    function populateFilters() {
        const dates = new Set();
        const times = new Set();
        const camps = new Set();

        allMatches.forEach(m => {
            if (m.dataOra && m.dataOra !== 'Data indisponibilă') {
                const parts = m.dataOra.split(' ');
                if (parts[0]) dates.add(parts[0]);
                if (parts[1]) times.add(parts[1]);
            }
            if (m.campionat) {
                camps.add(m.campionat);
            }
        });

        dateFilter.innerHTML = '<option value="">Toate datele</option>';
        Array.from(dates).sort().forEach(d => {
            dateFilter.innerHTML += `<option value="${d}">${d}</option>`;
        });

        timeFilter.innerHTML = '<option value="">Toate orele</option>';
        Array.from(times).sort().forEach(t => {
            timeFilter.innerHTML += `<option value="${t}">${t}</option>`;
        });

        campFilter.innerHTML = '<option value="">Toate campionatele</option>';
        Array.from(camps).sort().forEach(c => {
            campFilter.innerHTML += `<option value="${c}">${c}</option>`;
        });
    }

    function applyFilters() {
        const term = searchInput.value.toLowerCase().trim();
        const selectedDate = dateFilter.value;
        const selectedTime = timeFilter.value;
        const selectedCamp = campFilter.value;

        const filtered = allMatches.filter(m => {
            const matchTitle = (m.matchTitle || '').toLowerCase();
            const camp = (m.campionat || '').toLowerCase();
            const dateStr = m.dataOra || '';
            const dateParts = dateStr.split(' ');
            const matchDate = dateParts[0] || '';
            const matchTime = dateParts[1] || '';

            const matchesSearch = matchTitle.includes(term) || camp.includes(term);
            const matchesDate = selectedDate === '' || matchDate === selectedDate;
            const matchesTime = selectedTime === '' || matchTime === selectedTime;
            const matchesCamp = selectedCamp === '' || m.campionat === selectedCamp;

            return matchesSearch && matchesDate && matchesTime && matchesCamp;
        });

        renderMatches(filtered);
    }

    function extractTeamsFromTitle(title) {
        if (!title) return { t1: 'Echipa 1', t2: 'Echipa 2' };
        const parts = title.split(' vs ');
        return {
            t1: parts[0] || 'Echipa 1',
            t2: parts.length > 1 ? parts[1] : 'Echipa 2'
        };
    }

    const getIconForKey = (key) => {
        const k = key.toLowerCase();
        if (k.includes('corner')) return '<i class="fa-solid fa-flag" style="color: #ff9800; margin-right: 4px;"></i>';
        if (k.includes('galben')) return '<i class="fa-solid fa-square" style="color: #ffeb3b; margin-right: 4px; text-shadow: 0 0 1px #000;"></i>';
        if (k.includes('roș') || k.includes('ros')) return '<i class="fa-solid fa-square" style="color: #f44336; margin-right: 4px;"></i>';
        if (k.includes('gg') || k.includes('ng') || k.includes('p') || k.includes('s') || k.includes('1') || k.includes('2') || k.includes('x')) {
            return '<i class="fa-solid fa-futbol" style="color: #4caf50; margin-right: 4px;"></i>';
        }
        return '<i class="fa-solid fa-chart-line" style="color: #2196f3; margin-right: 4px;"></i>';
    };

    function checkPrediction(key, hG, aG) {
        if (hG === null || aG === null) return null;
        const total = hG + aG;
        switch (key) {
            case '1': return hG > aG;
            case '2': return aG > hG;
            case '1X': return hG >= aG;
            case 'X2': return aG >= hG;
            case 'GG': return hG > 0 && aG > 0;
            case 'NG': return hG === 0 || aG === 0;
            case 'P2.5': return total >= 3;
            case 'P1.5': return total >= 2;
            case 'S3.5': return total <= 3;
            case 'T1 P0.5': return hG >= 1;
            case 'T2 P0.5': return aG >= 1;
            default: return null;
        }
    }

    function createMatchCardElement(match) {
        const card = document.createElement('div');
        card.className = 'card';
        if (match.urlMeci) {
            card.setAttribute('data-url', match.urlMeci);
        }

        const teams = extractTeamsFromTitle(match.matchTitle);
        const imgHome = (match.echipaGazdaImg && match.echipaGazdaImg !== 'Poza indisponibilă') ? match.echipaGazdaImg : 'https://via.placeholder.com/60?text=T1';
        const imgAway = (match.echipaOaspeteImg && match.echipaOaspeteImg !== 'Poza indisponibilă') ? match.echipaOaspeteImg : 'https://via.placeholder.com/60?text=T2';

        let scorDisplay = match.scorMeciCurent || '-';
        if (scorDisplay === match.dataOra || scorDisplay === '- ()' || scorDisplay === 'Fără scor') {
            scorDisplay = '-';
        } else {
            scorDisplay = scorDisplay.replace(/\(.*?\)/g, '').trim();
        }

        let hGoals = null, aGoals = null;
        if (scorDisplay !== '-' && scorDisplay !== 'VS') {
            const parts = scorDisplay.split('-');
            if (parts.length === 2) {
                const h = parseInt(parts[0].trim());
                const a = parseInt(parts[1].trim());
                if (!isNaN(h) && !isNaN(a)) {
                    hGoals = h;
                    aGoals = a;
                }
            }
        }

        let predictionsHtml = '';
        let isValueBet = false;

        if (match.predictii && Object.keys(match.predictii).length > 0) {
            for (const [key, value] of Object.entries(match.predictii)) {
                if (key !== 'N/A') {
                    let colorClass = 'val-low';
                    if (value >= 90) {
                        colorClass = 'val-high';
                        isValueBet = true;
                    } else if (value >= 85) colorClass = 'val-high';
                    else if (value >= 75) colorClass = 'val-med';

                    let predStatusClass = '';
                    if (hGoals !== null && aGoals !== null) {
                        const isWon = checkPrediction(key, hGoals, aGoals);
                        if (isWon === true) predStatusClass = 'pred-won';
                        else if (isWon === false) predStatusClass = 'pred-lost';
                    }

                    predictionsHtml += `
                        <div class="pred-tag ${predStatusClass}">
                            <span>${getIconForKey(key)}${key} - </span>
                            <span class="${colorClass}">${value}%</span>
                        </div>
                    `;
                }
            }
        } else {
            predictionsHtml = '<span class="text-muted" style="font-size: 0.85rem;">Nu există predicții sigure</span>';
        }

        if (isValueBet) {
            card.classList.add('value-bet');
        }

        // Predicții extinse (cornere/cartonașe)
        let extHtml = '';
        if (match.predictiiExtinse && Object.keys(match.predictiiExtinse).length > 0) {
            for (const [k, v] of Object.entries(match.predictiiExtinse)) {
                if (k !== 'N/A') {
                    extHtml += `<span class="ext-badge">${getIconForKey(k)}${k} - <b>${v}%</b></span>`;
                }
            }
        }
        if (extHtml === '') extHtml = '<span class="text-muted" style="font-size:0.8rem">Fără date speciale</span>';

        // Predicții Prima Repriză
        let prHtml = '';
        if (match.predictiiPrimaRepriza && Object.keys(match.predictiiPrimaRepriza).length > 0) {
            for (const [k, v] of Object.entries(match.predictiiPrimaRepriza)) {
                if (k !== 'N/A') {
                    let colorClass = 'val-low';
                    if (v >= 90) colorClass = 'val-high';
                    else if (v >= 85) colorClass = 'val-high';
                    else if (v >= 75) colorClass = 'val-med';

                    prHtml += `
                        <div class="pred-tag">
                            <span>${getIconForKey(k)}${k} - </span>
                            <span class="${colorClass}">${v}%</span>
                        </div>
                    `;
                }
            }
        }
        if (prHtml === '') prHtml = '<span class="text-muted" style="font-size:0.8rem">Nu sunt sigure (PR)</span>';

        let scoreStyle = '';
        if (scorDisplay !== '-' && scorDisplay !== 'VS') {
            if (hGoals !== null && aGoals !== null) {
                if (hGoals > aGoals) scoreStyle = 'color: #00e676; text-shadow: 0 0 15px rgba(0, 230, 118, 0.5);';
                else if (hGoals < aGoals) scoreStyle = 'color: #ff3366; text-shadow: 0 0 15px rgba(255, 51, 102, 0.5);';
                else scoreStyle = 'color: #ffb300; text-shadow: 0 0 15px rgba(255, 179, 0, 0.5);';
            } else {
                scoreStyle = 'color: #00e676; text-shadow: 0 0 15px rgba(0, 230, 118, 0.5);';
            }
        }

        card.innerHTML = `
            ${isValueBet ? '<div class="value-bet-badge" title="Value Bet! Încredere &ge; 90%"><i class="fa-solid fa-star"></i></div>' : ''}
            <div class="card-header">
                <div class="championship">
                    <i class="fa-solid fa-trophy" style="color: var(--warning);"></i> 
                    ${escapeHtml(match.campionat || 'N/A')}
                </div>
                <div class="card-header-actions">
                    <div class="match-time">
                        <i class="fa-regular fa-clock"></i> ${escapeHtml(match.dataOra || 'N/A')}
                    </div>
                    <button class="delete-card-btn" title="Șterge acest meci">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            </div>

            <div class="teams">
                <div class="team">
                    <img src="${imgHome}" alt="${escapeHtml(teams.t1)}" class="team-logo" onerror="this.src='https://via.placeholder.com/60?text=T1'">
                    <div class="team-name">${escapeHtml(teams.t1)}</div>
                </div>
                
                <div class="score-area">
                    <div class="score-text" style="${scoreStyle}">${scorDisplay !== '-' ? escapeHtml(scorDisplay) : 'VS'}</div>
                </div>

                <div class="team">
                    <img src="${imgAway}" alt="${escapeHtml(teams.t2)}" class="team-logo" onerror="this.src='https://via.placeholder.com/60?text=T2'">
                    <div class="team-name">${escapeHtml(teams.t2)}</div>
                </div>
            </div>

            <div class="predictions-area">
                <div class="predictions-title">Recomandări Pariuri (Încredere)</div>
                <div class="predictions">
                    ${predictionsHtml}
                </div>
            </div>
            
            <div class="predictions-area" style="margin-top: 10px;">
                <div class="predictions-title">Prima Repriză</div>
                <div class="predictions">
                    ${prHtml}
                </div>
            </div>
            
            <div class="predictions-area" style="margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 10px;">
                <div class="predictions-title">Statistici Speciale (Cornere / Cartonașe)</div>
                <div class="predictions" style="gap: 5px; flex-wrap: wrap;">
                    ${extHtml}
                </div>
            </div>
        `;

        // Buton de ștergere meci individual
        const deleteBtn = card.querySelector('.delete-card-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const titlu = match.matchTitle || 'acest meci';
                if (!confirm(`Ești sigur că vrei să ștergi meciul "${titlu}"?`)) {
                    return;
                }

                try {
                    deleteBtn.disabled = true;
                    const res = await fetch('/api/delete-match', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            filename: fileSelector.value,
                            urlMeci: match.urlMeci,
                            matchTitle: match.matchTitle
                        })
                    });

                    const data = await res.json();
                    if (!res.ok) {
                        throw new Error(data.error || 'Eroare la ștergerea meciului.');
                    }

                    // Animație de ieșire
                    card.classList.add('card-deleting');
                    setTimeout(() => {
                        card.remove();

                        // Eliminăm meciul din starea locală
                        allMatches = allMatches.filter(m => {
                            if (match.urlMeci && m.urlMeci) return m.urlMeci !== match.urlMeci;
                            return m.matchTitle !== match.matchTitle;
                        });

                        matchesBadge.innerText = allMatches.length;
                        updateStatsOverview(allMatches);

                        // Curățăm secțiunea categoriei dacă a rămas goală
                        const categoryGrids = document.querySelectorAll('.category-grid');
                        categoryGrids.forEach(grid => {
                            if (grid.children.length === 0) {
                                const header = grid.previousElementSibling;
                                if (header && header.classList.contains('category-header')) {
                                    header.remove();
                                }
                                grid.remove();
                            }
                        });

                        if (allMatches.length === 0) {
                            renderMatches([]);
                        }

                        showToast(`Meciul "${titlu}" a fost șters!`, 'success');
                    }, 350);

                } catch (err) {
                    deleteBtn.disabled = false;
                    showToast(err.message, 'error');
                }
            });
        }

        return card;
    }

    function renderMatches(matches) {
        container.innerHTML = '';

        if (!matches || matches.length === 0) {
            container.innerHTML = `
                <div class="no-data">
                    <i class="fa-solid fa-futbol fa-3x" style="color: var(--text-muted); margin-bottom: 1rem;"></i>
                    <h2>Nu am găsit meciuri</h2>
                    <p>Încearcă o altă căutare sau folosește Tab 1 pentru a introduce un link de Flashscore.</p>
                    <button class="btn btn-primary-glow" style="margin: 1.5rem auto 0 auto;" onclick="switchTab('tab-scraper')">
                        <i class="fa-solid fa-bolt"></i> Analizează Meci Acum
                    </button>
                </div>
            `;
            return;
        }

        const grouped = {};
        matches.forEach(match => {
            const camp = match.campionat || 'Campionat necunoscut';
            if (!grouped[camp]) grouped[camp] = [];
            grouped[camp].push(match);
        });

        const sortedCamps = Object.keys(grouped).sort();

        sortedCamps.forEach(camp => {
            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = `<i class="fa-solid fa-trophy" style="color: var(--warning);"></i> ${escapeHtml(camp)} (${grouped[camp].length})`;
            container.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'category-grid';

            grouped[camp].forEach(match => {
                grid.appendChild(createMatchCardElement(match));
            });

            container.appendChild(grid);
        });
    }

    // Filter listeners
    searchInput.addEventListener('input', applyFilters);
    dateFilter.addEventListener('change', applyFilters);
    timeFilter.addEventListener('change', applyFilters);
    campFilter.addEventListener('change', applyFilters);
    refreshBtn.addEventListener('click', () => loadMatchesFromFile(fileSelector.value));

    const deleteFileBtn = document.getElementById('delete-file-btn');
    if (deleteFileBtn) {
        deleteFileBtn.addEventListener('click', async () => {
            const currentFile = fileSelector.value;
            if (!currentFile) {
                showToast('Niciun fișier selectat pentru ștergere.', 'error');
                return;
            }

            if (!confirm(`ATENȚIE: Ești sigur că vrei să ștergi definitiv fișierul "${currentFile}" (${allMatches.length} meciuri)?`)) {
                return;
            }

            try {
                const res = await fetch('/api/delete-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: currentFile })
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Eroare la ștergerea fișierului.');
                }

                showToast(data.message || 'Fișierul a fost șters cu succes!', 'success');
                await loadFilesAndMatches();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }

    fileSelector.addEventListener('change', () => {
        loadMatchesFromFile(fileSelector.value);
    });

    fileDatePicker.addEventListener('change', () => {
        const val = fileDatePicker.value;
        if (!val) return;
        const parts = val.split('-');
        if (parts.length === 3) {
            const targetFilename = `statistici_${parts[2]}-${parts[1]}-${parts[0]}.json`;
            // Căutăm în selector
            let found = false;
            for (let opt of fileSelector.options) {
                if (opt.value === targetFilename) {
                    fileSelector.value = targetFilename;
                    loadMatchesFromFile(targetFilename);
                    found = true;
                    break;
                }
            }
            if (!found) {
                showToast(`Nu există fișierul ${targetFilename}.`, 'error');
            }
        }
    });

    // Make switchTab globally accessible for inline buttons
    window.switchTab = switchTab;

    // ==========================================
    // INITIALIZATION
    // ==========================================
    initSSE();
    loadFilesAndMatches();
});
