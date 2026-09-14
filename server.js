const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Stare globală pentru jobul activ de scraping
let activeProcess = null;
let activeJob = null;
const subscribers = new Set();

function broadcastSSE(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of subscribers) {
        try {
            res.write(payload);
        } catch (err) {
            subscribers.delete(res);
        }
    }
}

function addLog(text, level = 'info') {
    const logItem = {
        text,
        level,
        time: new Date().toLocaleTimeString('ro-RO')
    };
    if (activeJob) {
        activeJob.logs.push(logItem);
        // Păstrăm ultimele 1000 de linii
        if (activeJob.logs.length > 1000) {
            activeJob.logs.shift();
        }
    }
    broadcastSSE({ type: 'log', ...logItem });
}

// 1. Endpoint pentru pornirea scraper-ului
app.post('/api/analyze', (req, res) => {
    let { url, mode } = req.body;

    if (activeProcess) {
        return res.status(409).json({
            error: 'Un proces de analiză este deja în derulare. Te rugăm să aștepți finalizarea sau să îl oprești.'
        });
    }

    if (mode === 'single' || (!mode && url)) {
        mode = 'single';
        if (!url || typeof url !== 'string' || url.trim().length === 0) {
            return res.status(400).json({ error: 'Te rugăm să introduci un link valid de meci Flashscore.' });
        }
        url = url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        if (!url.includes('flashscore')) {
            return res.status(400).json({ error: 'Link-ul trebuie să fie de pe flashscore (ex: flashscore.ro sau flashscore.com).' });
        }
    } else if (mode !== 'live' && mode !== 'ieri') {
        return res.status(400).json({ error: 'Mod de analiză invalid.' });
    }

    const jobId = Date.now().toString();
    activeJob = {
        id: jobId,
        url: url || null,
        mode,
        status: 'running',
        startTime: Date.now(),
        logs: []
    };

    const args = ['scraper.js'];
    if (mode === 'live') {
        args.push('live');
    } else if (mode === 'ieri') {
        args.push('ieri');
    } else if (url) {
        args.push(url);
    }

    addLog(`🚀 Inițiere analiză (Mod: ${mode.toUpperCase()})...`, 'info');
    if (url) {
        addLog(`🔗 Link țintă: ${url}`, 'info');
    }

    try {
        activeProcess = spawn('node', args, {
            cwd: __dirname,
            shell: true,
            env: { ...process.env, FORCE_COLOR: '1' }
        });

        activeProcess.stdout.on('data', (chunk) => {
            const lines = chunk.toString().split(/\r?\n/);
            for (const line of lines) {
                if (line.trim().length > 0) {
                    let level = 'info';
                    const lower = line.toLowerCase();
                    if (lower.includes('[succes]') || lower.includes('am terminat') || lower.includes('salvate')) {
                        level = 'success';
                    } else if (lower.includes('[eroare]') || lower.includes('fail') || lower.includes('error')) {
                        level = 'error';
                    } else if (lower.includes('[avertisment]') || lower.includes('warning') || lower.includes('[actualizare')) {
                        level = 'warning';
                    }
                    addLog(line, level);
                }
            }
        });

        activeProcess.stderr.on('data', (chunk) => {
            const lines = chunk.toString().split(/\r?\n/);
            for (const line of lines) {
                if (line.trim().length > 0) {
                    addLog(line, 'error');
                }
            }
        });

        activeProcess.on('close', (code) => {
            const duration = ((Date.now() - activeJob.startTime) / 1000).toFixed(1);
            const isSuccess = code === 0;
            if (activeJob) {
                activeJob.status = isSuccess ? 'completed' : 'failed';
                activeJob.exitCode = code;
                activeJob.duration = duration;
            }

            if (isSuccess) {
                addLog(`✨ Analiza s-a finalizat cu succes în ${duration} secunde!`, 'success');
            } else {
                addLog(`⚠️ Procesul s-a încheiat cu codul de ieșire: ${code} (${duration}s)`, 'error');
            }

            broadcastSSE({
                type: 'finished',
                success: isSuccess,
                exitCode: code,
                duration
            });

            activeProcess = null;
        });

        activeProcess.on('error', (err) => {
            addLog(`❌ Eroare la pornirea procesului: ${err.message}`, 'error');
            if (activeJob) {
                activeJob.status = 'failed';
                activeJob.error = err.message;
            }
            broadcastSSE({ type: 'error', message: err.message });
            activeProcess = null;
        });

        res.json({
            success: true,
            jobId,
            message: 'Analiza a fost pornită cu succes în fundal.'
        });
    } catch (err) {
        activeProcess = null;
        res.status(500).json({ error: `Eroare server: ${err.message}` });
    }
});

// 2. Endpoint Server-Sent Events pentru loguri live
app.get('/api/stream-logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Trimitem starea curentă
    res.write(`data: ${JSON.stringify({
        type: 'status',
        isRunning: !!activeProcess,
        job: activeJob
    })}\n\n`);

    // Dacă avem loguri anterioare în jobul activ, le trimitem imediat
    if (activeJob && activeJob.logs) {
        for (const log of activeJob.logs) {
            res.write(`data: ${JSON.stringify({ type: 'log', ...log })}\n\n`);
        }
    }

    subscribers.add(res);

    req.on('close', () => {
        subscribers.delete(res);
    });
});

// 3. Stare proces curent
app.get('/api/status', (req, res) => {
    res.json({
        isRunning: !!activeProcess,
        job: activeJob
    });
});

// 4. Oprire proces curent (Cancel)
app.post('/api/cancel', (req, res) => {
    if (!activeProcess) {
        return res.json({ message: 'Nu rulează niciun proces activ.' });
    }

    addLog('🛑 Utilizatorul a cerut oprirea forțată a procesului...', 'warning');

    const pid = activeProcess.pid;
    if (process.platform === 'win32' && pid) {
        exec(`taskkill /pid ${pid} /T /F`, (error) => {
            if (error) {
                try { activeProcess.kill('SIGKILL'); } catch (_) {}
            }
            activeProcess = null;
            if (activeJob) activeJob.status = 'cancelled';
            broadcastSSE({ type: 'cancelled', message: 'Procesul a fost oprit forțat.' });
            res.json({ success: true, message: 'Proces oprit.' });
        });
    } else {
        try {
            activeProcess.kill('SIGTERM');
        } catch (_) {}
        activeProcess = null;
        if (activeJob) activeJob.status = 'cancelled';
        broadcastSSE({ type: 'cancelled', message: 'Procesul a fost oprit.' });
        res.json({ success: true, message: 'Proces oprit.' });
    }
});

// 5. Listă fișiere JSON statistici disponibile
app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(__dirname);
        const jsonFiles = files
            .filter(f => f.startsWith('statistici') && f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(__dirname, f);
                const stats = fs.statSync(fullPath);
                let matchCount = 0;
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const parsed = JSON.parse(content);
                    matchCount = Array.isArray(parsed) ? parsed.length : 0;
                } catch (_) {}

                return {
                    name: f,
                    size: stats.size,
                    mtime: stats.mtime,
                    matchCount
                };
            })
            .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

        res.json({ files: jsonFiles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Obținere meciuri dintr-un fișier specific sau cel mai recent
app.get('/api/matches', (req, res) => {
    let filename = req.query.file;

    try {
        const files = fs.readdirSync(__dirname)
            .filter(f => f.startsWith('statistici') && f.endsWith('.json'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(__dirname, f)).mtime }))
            .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

        if (!filename) {
            if (files.length === 0) {
                return res.json({ matches: [], filename: null, message: 'Nu există încă date extrase.' });
            }
            filename = files[0].name;
        }

        // Prevenim directory traversal
        const safeName = path.basename(filename);
        const filePath = path.join(__dirname, safeName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `Fișierul ${safeName} nu a fost găsit.` });
        }

        const raw = fs.readFileSync(filePath, 'utf8');
        const matches = JSON.parse(raw);
        res.json({
            matches: Array.isArray(matches) ? matches : [],
            filename: safeName,
            total: Array.isArray(matches) ? matches.length : 0
        });
    } catch (err) {
        res.status(500).json({ error: `Eroare la citirea fișierului: ${err.message}` });
    }
});

// 7. Ștergere meci specific dintr-un fișier
app.post('/api/delete-match', (req, res) => {
    const { filename, urlMeci, matchTitle } = req.body;

    if (!filename) {
        return res.status(400).json({ error: 'Numele fișierului este obligatoriu.' });
    }

    try {
        const safeName = path.basename(filename);
        const filePath = path.join(__dirname, safeName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `Fișierul ${safeName} nu a fost găsit.` });
        }

        const raw = fs.readFileSync(filePath, 'utf8');
        let matches = JSON.parse(raw);

        if (!Array.isArray(matches)) {
            return res.status(400).json({ error: 'Format JSON invalid.' });
        }

        const initialCount = matches.length;
        matches = matches.filter(m => {
            if (urlMeci && m.urlMeci && m.urlMeci === urlMeci) return false;
            if (matchTitle && m.matchTitle && m.matchTitle === matchTitle) return false;
            return true;
        });

        const deletedCount = initialCount - matches.length;
        fs.writeFileSync(filePath, JSON.stringify(matches, null, 2), 'utf8');

        res.json({
            success: true,
            deletedCount,
            remaining: matches.length,
            message: deletedCount > 0 ? 'Meciul a fost șters cu succes.' : 'Meciul nu a fost găsit.'
        });
    } catch (err) {
        res.status(500).json({ error: `Eroare la ștergerea meciului: ${err.message}` });
    }
});

// 8. Ștergere întreg fișier de statistici
app.post('/api/delete-file', (req, res) => {
    const { filename } = req.body;

    if (!filename) {
        return res.status(400).json({ error: 'Numele fișierului este obligatoriu.' });
    }

    try {
        const safeName = path.basename(filename);
        const filePath = path.join(__dirname, safeName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `Fișierul ${safeName} nu a fost găsit.` });
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, message: `Fișierul ${safeName} a fost șters.` });
    } catch (err) {
        res.status(500).json({ error: `Eroare la ștergerea fișierului: ${err.message}` });
    }
});

// Servire fișiere statice (index.html, style.css, app.js etc.)
app.use(express.static(__dirname));

// Fallback către index.html
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`🚀 Serverul Fotbal Statistici rulează pe: http://localhost:${PORT}`);
    console.log(`⚡ Tab 1: Analiză Live Flashscore`);
    console.log(`🏆 Tab 2: Carduri Meciuri & Predicții`);
    console.log(`=================================================\n`);
});
