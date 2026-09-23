// Importuri explicite pentru modulele de evaziune (necesare pentru compilare/bundling în medii precum Vercel/Webpack)
try {
    require('puppeteer-extra-plugin-user-preferences');
    require('puppeteer-extra-plugin-user-data-dir');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.app');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.csi');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.loadTimes');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.runtime');
    require('puppeteer-extra-plugin-stealth/evasions/defaultArgs');
    require('puppeteer-extra-plugin-stealth/evasions/iframe.contentWindow');
    require('puppeteer-extra-plugin-stealth/evasions/media.codecs');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.permissions');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.plugins');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.webdriver');
    require('puppeteer-extra-plugin-stealth/evasions/sourceurl');
    require('puppeteer-extra-plugin-stealth/evasions/user-agent-override');
    require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor');
    require('puppeteer-extra-plugin-stealth/evasions/window.outerdimensions');
} catch (_) {}

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    console.log('Pornim browser-ul...');
    const browser = await puppeteer.launch({
        headless: true, // Setat pe false pentru a vedea ce se întâmplă
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        defaultViewport: null,
        args: [
            '--window-size=1200,800',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-background-timer-throttling'
        ]
    });

    const page = await browser.newPage();

    // Optimizare: Blocăm resursele inutile
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    const isLive = process.argv.includes('live');
    const isIeri = process.argv.includes('ieri');
    const directUrlArg = process.argv.find(arg => arg.startsWith('http'));
    let matchUrls = [];

    const fs = require('fs');
    // Generăm numele fișierului pe baza datei curente (sau ieri)
    const azi = new Date();
    if (isIeri) {
        azi.setDate(azi.getDate() - 1);
    }
    const zi = String(azi.getDate()).padStart(2, '0');
    const luna = String(azi.getMonth() + 1).padStart(2, '0');
    const an = azi.getFullYear();
    const fisierDate = `statistici_${zi}-${luna}-${an}.json`;

    // --- LOGICA FAST-UPDATE PENTRU ZIUA PRECEDENTĂ ---
    if (isIeri) {
        console.log(`\n--- MOD ACTUALIZARE SCORURI (IERI) ---`);
        console.log(`Se actualizează doar scorurile din fișierul: ${fisierDate}`);

        if (!fs.existsSync(fisierDate)) {
            console.log(`[EROARE] Fișierul ${fisierDate} nu există! Nu se pot actualiza scorurile fără meciurile extrase anterior.`);
            await browser.close();
            return;
        }

        let existingData = [];
        try {
            existingData = JSON.parse(fs.readFileSync(fisierDate, 'utf8'));
        } catch (e) {
            console.log(`[EROARE] Fișierul ${fisierDate} este corupt.`);
            await browser.close();
            return;
        }

        let actualizate = 0;
        for (let i = 0; i < existingData.length; i++) {
            const m = existingData[i];
            console.log(`[Actualizare Scor] ${i + 1}/${existingData.length} - ${m.matchTitle}`);
            try {
                // Mergem direct pe pagina H2H a meciului unde găsim scorul sigur
                await page.goto(m.urlMeci, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Așteptăm scorul dar cu un timeout mic ca să nu pierdem vremea dacă meciul e anulat
                await page.waitForSelector('.detailScore__wrapper', { timeout: 6000 }).catch(() => { });

                const scorUpdate = await page.evaluate(() => {
                    const scoreWrapper = document.querySelector('.detailScore__wrapper');
                    if (scoreWrapper) {
                        const spans = scoreWrapper.querySelectorAll('span');
                        let scor = '';
                        if (spans.length >= 3) {
                            scor = `${spans[0].innerText.trim()} ${spans[1].innerText.trim()} ${spans[2].innerText.trim()}`;
                        } else {
                            scor = scoreWrapper.innerText.replace(/\n/g, ' ').trim();
                        }
                        const statusEl = document.querySelector('.fixedHeaderDuel__detailStatus, .detailScore__status span');
                        const statusText = statusEl ? ` (${statusEl.innerText.trim()})` : '';
                        return scor + statusText;
                    }
                    return null;
                });

                if (scorUpdate) {
                    m.scorMeciCurent = scorUpdate;
                    console.log(`  -> Nou scor: ${scorUpdate}`);
                    actualizate++;
                } else {
                    console.log(`  -> Nu am găsit un scor (posibil meci anulat/amânat).`);
                }
            } catch (e) {
                console.log(`  -> Eroare la accesare pagină: ${e.message}`);
            }

            // Salvăm progresiv ca să nu pierdem date
            fs.writeFileSync(fisierDate, JSON.stringify(existingData, null, 2));
        }

        console.log(`\n[SUCCES] Am actualizat ${actualizate} scoruri în ${fisierDate}.`);
        await browser.close();
        return; // Ieșim din script!
    }
    // ---------------------------------------------------

    if (directUrlArg) {
        console.log(`URL direct detectat. Vom procesa doar meciul: ${directUrlArg}`);
        matchUrls.push(directUrlArg);
    } else {
        console.log('Navigăm către Flashscore...');
        await page.goto('https://www.flashscore.ro/', { waitUntil: 'domcontentloaded' });

        try {
            await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000 });
            await page.click('#onetrust-accept-btn-handler');
            console.log('Am acceptat cookie-urile.');
        } catch (e) {
            console.log('Nu am găsit popup-ul de cookies sau a expirat timpul.');
        }

        if (isLive) {
            console.log('Parametrul "live" detectat. Trecem pe tab-ul de meciuri LIVE...');
            await page.evaluate(() => {
                const tabs = document.querySelectorAll('.filters__tab');
                for (let tab of tabs) {
                    if (tab.innerText.trim() === 'LIVE') {
                        tab.click();
                        break;
                    }
                }
            });
            // Așteptăm ca DOM-ul să se actualizeze
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('Așteptăm să se încarce meciurile...');
        try {
            await page.waitForSelector('.event__match', { timeout: 15000 });
        } catch (e) {
            console.log('Nu s-au găsit meciuri (posibil să nu fie meciuri live momentan). Ieșim.');
            await browser.close();
            return;
        }

        matchUrls = await page.evaluate(() => {
            const matchLinks = document.querySelectorAll('.event__match a.eventRowLink');
            const urls = [];
            matchLinks.forEach(a => {
                const href = a.getAttribute('href');
                if (href) {
                    urls.push(href);
                }
            });
            return urls;
        });

        console.log(`Am găsit ${matchUrls.length} meciuri în total.`);
    }

    // Pentru a demonstra viteza, putem crește limita la 6 (procesăm în calupuri de câte 3)
    const limitaMeciuri = 10;
    const matchesToScrape = matchUrls.slice(0, limitaMeciuri);

    console.log(`Vom procesa primele ${matchesToScrape.length} meciuri în calupuri (concurent)...`);

    let statistics = [];
    if (fs.existsSync(fisierDate)) {
        try {
            const dateVechi = fs.readFileSync(fisierDate, 'utf8');
            if (dateVechi) {
                statistics = JSON.parse(dateVechi);
                console.log(`[Info] Am încărcat ${statistics.length} meciuri deja existente din ${fisierDate}. Nu le vom pierde!`);
            }
        } catch (e) {
            console.log(`[Avertisment] Nu am putut citi fisierul vechi. Incepem cu lista goala.`);
        }
    }
    
    let meciuriProcesate = 0;

    // Funcție asincronă izolată pentru a procesa un singur meci
    async function proceseazaMeci(originalUrl, matchPage) {
        let h2hUrl = originalUrl;

        if (!h2hUrl.startsWith('http')) {
            h2hUrl = 'https://www.flashscore.ro' + (h2hUrl.startsWith('/') ? '' : '/') + h2hUrl;
        }

        // Curățare și normalizare URL pentru a ajunge direct pe H2H / Total
        if (!h2hUrl.includes('/h2h/total/') && !h2hUrl.includes('#/h2h/total')) {
            if (h2hUrl.includes('#/')) {
                // Înlocuim orice secțiune hash (#/sumar-meci, #/cote etc.) cu #/h2h/total
                h2hUrl = h2hUrl.replace(/#\/.*$/, '#/h2h/total');
            } else if (h2hUrl.includes('?')) {
                const parts = h2hUrl.split('?');
                let basePath = parts[0];
                if (!basePath.endsWith('/')) basePath += '/';
                h2hUrl = `${basePath}h2h/total/?${parts[1]}`;
            } else {
                if (!h2hUrl.endsWith('/')) h2hUrl += '/';
                h2hUrl = `${h2hUrl}#/h2h/total`;
            }
        }

        console.log(`[Procesează] ${h2hUrl}`);

        try {
            // Folosim domcontentloaded ca să nu dea timeout la 30s, dar așteptăm elementele specifice.
            await matchPage.goto(h2hUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Așteptăm explicit să apară un rând cu un meci (nu doar containerul gol al secțiunii)
            await matchPage.waitForSelector('.h2h__row', { timeout: 15000 }).catch(() => { });

            // Pauză mică suplimentară pentru siguranța randării tuturor grupurilor (Formă/H2H)
            await new Promise(resolve => setTimeout(resolve, 300));

            const h2hData = await matchPage.evaluate(() => {
                const data = {};
                const participantHome = document.querySelector('.duelParticipant__home .participant__participantName')?.innerText || 'Echipa 1';
                const participantAway = document.querySelector('.duelParticipant__away .participant__participantName')?.innerText || 'Echipa 2';

                // Extragere Campionat prin breadcrumbs (structura nouă Flashscore)
                let campionat = 'Campionat necunoscut';
                const breadcrumbSpans = Array.from(document.querySelectorAll('[data-testid="wcl-scores-overline-03"]'));
                if (breadcrumbSpans.length >= 3) {
                    // Index 0 e "Fotbal", index 1 e "Țara", index 2 e "Liga"
                    campionat = breadcrumbSpans[1].innerText.trim() + ': ' + breadcrumbSpans[2].innerText.trim();
                } else if (breadcrumbSpans.length === 2) {
                    campionat = breadcrumbSpans[0].innerText.trim() + ': ' + breadcrumbSpans[1].innerText.trim();
                } else {
                    // Fallback
                    const links = Array.from(document.querySelectorAll('a'));
                    const sportLinkIdx = links.findIndex(a => a.getAttribute('href') === '/fotbal/');
                    if (sportLinkIdx !== -1 && links.length > sportLinkIdx + 2) {
                        const tara = links[sportLinkIdx + 1]?.innerText;
                        const liga = links[sportLinkIdx + 2]?.innerText;
                        if (tara && liga) {
                            campionat = tara + ': ' + liga;
                        }
                    }
                }
                data.campionat = campionat;

                // Extragere Poze (Sigle echipe)
                const imgHome = document.querySelector('.duelParticipant__home img');
                const imgAway = document.querySelector('.duelParticipant__away img');
                data.echipaGazdaImg = imgHome ? imgHome.getAttribute('src') : 'Poza indisponibilă';
                data.echipaOaspeteImg = imgAway ? imgAway.getAttribute('src') : 'Poza indisponibilă';

                // Extragere data și ora
                const startTime = document.querySelector('.duelParticipant__startTime');
                data.dataOra = startTime ? startTime.innerText.replace(/\n/g, ' ').trim() : 'Data indisponibilă';

                // Extragere Scor Curent (sau data/ora dacă nu a început)
                const scoreWrapper = document.querySelector('.detailScore__wrapper');
                if (scoreWrapper) {
                    const spans = scoreWrapper.querySelectorAll('span');
                    let scor = '';
                    if (spans.length >= 3) {
                        scor = `${spans[0].innerText.trim()} ${spans[1].innerText.trim()} ${spans[2].innerText.trim()}`;
                    } else {
                        scor = scoreWrapper.innerText.replace(/\n/g, ' ').trim();
                    }
                    // Adăugăm și statusul (ex: "Final") dacă există
                    const statusEl = document.querySelector('.fixedHeaderDuel__detailStatus, .detailScore__status span');
                    const statusText = statusEl ? ` (${statusEl.innerText.trim()})` : '';
                    data.scorMeciCurent = scor + statusText;
                } else {
                    data.scorMeciCurent = data.dataOra !== 'Data indisponibilă' ? data.dataOra : 'Fără scor';
                }

                data.matchTitle = `${participantHome} vs ${participantAway}`;
                data.h2hGroups = [];

                const sections = document.querySelectorAll('.h2h__section');
                sections.forEach(section => {
                    const titleEl = section.querySelector('[data-testid="wcl-headerSection-text"]');
                    const groupTitle = titleEl ? titleEl.innerText.trim() : 'H2H';

                    const group = { title: groupTitle, matches: [] };

                    const rows = section.querySelectorAll('.h2h__row');
                    rows.forEach(row => {
                        const date = row.querySelector('.wclH2h__date')?.innerText.trim();
                        const homeTeam = row.querySelector('.h2h__homeParticipant')?.innerText.trim();
                        const awayTeam = row.querySelector('.h2h__awayParticipant')?.innerText.trim();

                        // Reparăm scorul: Flashscore ține golurile în tag-uri span separate care se "lipesc" la innerText
                        const scoreSpans = row.querySelectorAll('.h2h__result span');
                        let result = '';
                        if (scoreSpans.length >= 2) {
                            result = `${scoreSpans[0].innerText.trim()} - ${scoreSpans[1].innerText.trim()}`;
                        } else {
                            result = row.querySelector('.h2h__result')?.innerText.trim() || '';
                        }

                        let href = row.getAttribute('href');
                        let h2hLink = '';
                        if (href) {
                            const parts = href.split('?');
                            if (parts.length === 2) {
                                let basePath = parts[0];
                                if (!basePath.endsWith('/')) basePath += '/';
                                h2hLink = `${basePath}h2h/total/?${parts[1]}`;
                                if (!h2hLink.startsWith('http')) h2hLink = 'https://www.flashscore.ro' + h2hLink;
                            }
                        }

                        if (date && homeTeam && awayTeam && result) {
                            group.matches.push({ data: date, gazde: homeTeam, oaspeti: awayTeam, scor: result, url_h2h: h2hLink });
                        }
                    });
                    data.h2hGroups.push(group);
                });
                return data;
            });

            // --- Extragere statistici pentru fiecare meci H2H ---
            async function extrageStatisticiMeci(meciUrl, p) {
                if (!meciUrl) return null;
                if (p.isClosed()) return null;

                const urlTotal = meciUrl.replace('/h2h/total/', '/sumar/statistici/total/');
                const urlRepriza1 = meciUrl.replace('/h2h/total/', '/sumar/statistici/repriza-1/');
                const urlRezumat = meciUrl.replace('/h2h/total/', '/sumar/rezumat/');

                const resultStats = {
                    total: null,
                    primaRepriza: null,
                    scorPrimaRepriza: null
                };

                const extractStats = async (url) => {
                    try {
                        await p.goto(url, { waitUntil: 'load', timeout: 30000 });
                        if (p.isClosed()) return null;
                        await p.waitForSelector('[data-testid="wcl-statistics"]', { timeout: 5000 }).catch(() => { });
                        if (p.isClosed()) return null;

                        const statsData = await p.evaluate(() => {
                            const statBlocks = document.querySelectorAll('[data-testid="wcl-statistics"]');
                            const rezultat = [];
                            statBlocks.forEach(block => {
                                const values = block.querySelectorAll('[data-testid="wcl-statistics-value"]');
                                const categoryEl = block.querySelector('[data-testid="wcl-statistics-category"]');
                                if (values.length >= 2 && categoryEl) {
                                    rezultat.push({
                                        categorie: categoryEl.innerText.trim(),
                                        gazde: values[0].innerText.trim(),
                                        oaspete: values[1].innerText.trim()
                                    });
                                }
                            });
                            return rezultat;
                        });
                        return statsData.length > 0 ? statsData : null;
                    } catch (e) {
                        return null;
                    }
                };

                // Preluăm statisticile
                resultStats.total = await extractStats(urlTotal);
                resultStats.primaRepriza = await extractStats(urlRepriza1);

                // Preluăm scorul la pauză din rezumat
                try {
                    await p.goto(urlRezumat, { waitUntil: 'load', timeout: 30000 });
                    if (!p.isClosed()) {
                        const htScore = await p.evaluate(() => {
                            const headers = document.querySelectorAll('.smv__incidentsHeader');
                            for (const h of headers) {
                                const text = h.innerText || '';
                                if (text.includes('Repriza 1') || text.includes('1. repriză')) {
                                    return text.replace(/\\n/g, ' ').replace(/Repriza 1|1\\. repriză/gi, '').trim();
                                }
                            }
                            return null;
                        });
                        resultStats.scorPrimaRepriza = htScore;
                    }
                } catch (e) {
                    // ignorăm erorile pentru scor
                }

                if (resultStats.total || resultStats.primaRepriza || resultStats.scorPrimaRepriza) {
                    return resultStats;
                }
                return null;
            }

            // Îmbogățim fiecare meci din grupele H2H cu statisticile lui
            console.log(`  [Stats H2H] Extrag statistici pentru meciurile din H2H: ${h2hData.matchTitle}`);
            for (const group of h2hData.h2hGroups) {
                for (const match of group.matches) {
                    if (match.url_h2h) {
                        match.statisticiMeci = await extrageStatisticiMeci(match.url_h2h, matchPage);
                    }
                }
            }

            const teams = h2hData.matchTitle.split(' vs ');
            const team1 = teams[0].trim();
            const team2 = teams.length > 1 ? teams[1].trim() : 'Echipa2';

            function calculeazaStatistici(meciuri, numeEchipaTinta, repriza1 = false) {
                if (!meciuri || meciuri.length === 0) return null;
                let stats = {
                    totalMeciuri: meciuri.length, victoriiEchipa1: 0, victoriiEchipa2: 0,
                    egaluri: 0, goluriEchipa1: 0, goluriEchipa2: 0, ambeleMarcheaza: 0,
                    peste1_5: 0, peste2_5: 0, cleanSheetsEchipa1: 0
                };
                meciuri.forEach(m => {
                    const scorTinta = repriza1 ? (m.statisticiMeci?.scorPrimaRepriza || '') : m.scor;
                    const numbers = scorTinta.match(/\d+/g);
                    if (numbers && numbers.length >= 2) {
                        const gHome = parseInt(numbers[0]), gAway = parseInt(numbers[1]);
                        let matchTeam1Goals = 0, matchTeam2Goals = 0;
                        const gazdeUpper = m.gazde.toUpperCase(), teamTintaUpper = numeEchipaTinta.toUpperCase();

                        // MATCHING INTELIGENT: Scoate "(TUR)", "(AUT)" etc. și folosește doar numele de bază
                        const numeScurt = teamTintaUpper.replace(/\s*\(.*?\)\s*/g, '').trim();
                        const keywords = numeScurt.split(' ').filter(p => p.length >= 4); // Caută doar cuvinte relevante
                        let isTeam1Home = false;

                        if (keywords.length > 0) {
                            isTeam1Home = keywords.some(k => gazdeUpper.includes(k));
                        }
                        if (!isTeam1Home) {
                            isTeam1Home = gazdeUpper.includes(teamTintaUpper) || teamTintaUpper.includes(gazdeUpper);
                        }

                        if (isTeam1Home) { matchTeam1Goals = gHome; matchTeam2Goals = gAway; }
                        else { matchTeam1Goals = gAway; matchTeam2Goals = gHome; }

                        stats.goluriEchipa1 += matchTeam1Goals; stats.goluriEchipa2 += matchTeam2Goals;
                        if (matchTeam1Goals > matchTeam2Goals) stats.victoriiEchipa1++;
                        else if (matchTeam2Goals > matchTeam1Goals) stats.victoriiEchipa2++;
                        else stats.egaluri++;

                        if (matchTeam1Goals > 0 && matchTeam2Goals > 0) stats.ambeleMarcheaza++;
                        if ((matchTeam1Goals + matchTeam2Goals) > 0) stats.peste0_5++;
                        if ((matchTeam1Goals + matchTeam2Goals) > 1) stats.peste1_5++;
                        if ((matchTeam1Goals + matchTeam2Goals) > 2) stats.peste2_5++;
                        if (matchTeam2Goals === 0) stats.cleanSheetsEchipa1++;
                    }
                });
                return stats;
            }

            // Funcție pentru statistici extinse: cornere + cartonașe din statisticiMeci
            function calculeazaStatisticiExtinse(meciuri, tip = 'total') {
                if (!meciuri || meciuri.length === 0) return null;
                let meciuriCuStats = 0;
                let totalCornereGazde = 0, totalCornereOaspete = 0;
                let totalGalbeneGazde = 0, totalGalbeneOaspete = 0;
                let totalRosiGazde = 0, totalRosiOaspete = 0;
                let peste8_5Cornere = 0, peste9_5Cornere = 0, peste10_5Cornere = 0;
                let peste2Galbene = 0, peste3Galbene = 0;

                meciuri.forEach(m => {
                    const statsArray = m.statisticiMeci ? m.statisticiMeci[tip] : null;
                    if (!statsArray || statsArray.length === 0) return;
                    meciuriCuStats++;

                    const getStat = (categorie) => {
                        const entry = statsArray.find(s =>
                            s.categorie.toLowerCase().includes(categorie.toLowerCase())
                        );
                        if (!entry) return null;
                        return {
                            gazde: parseInt(entry.gazde) || 0,
                            oaspete: parseInt(entry.oaspete) || 0
                        };
                    };

                    const cornere = getStat('Cornere');
                    if (cornere) {
                        const totalCornere = cornere.gazde + cornere.oaspete;
                        totalCornereGazde += cornere.gazde;
                        totalCornereOaspete += cornere.oaspete;
                        if (totalCornere > 8.5) peste8_5Cornere++;
                        if (totalCornere > 9.5) peste9_5Cornere++;
                        if (totalCornere > 10.5) peste10_5Cornere++;
                    }

                    const galbene = getStat('Cartonaș galben') || getStat('Cartonașe galbene') || getStat('galben');
                    if (galbene) {
                        const totalGalbene = galbene.gazde + galbene.oaspete;
                        totalGalbeneGazde += galbene.gazde;
                        totalGalbeneOaspete += galbene.oaspete;
                        if (totalGalbene > 2) peste2Galbene++;
                        if (totalGalbene > 3) peste3Galbene++;
                    }

                    const rosii = getStat('Cartonaș roș') || getStat('Cartonașe roș') || getStat('roș');
                    if (rosii) {
                        totalRosiGazde += rosii.gazde;
                        totalRosiOaspete += rosii.oaspete;
                    }
                });

                if (meciuriCuStats === 0) return null;

                return {
                    meciuriCuDate: meciuriCuStats,
                    cornere: {
                        mediaGazde: parseFloat((totalCornereGazde / meciuriCuStats).toFixed(1)),
                        mediaOaspete: parseFloat((totalCornereOaspete / meciuriCuStats).toFixed(1)),
                        mediaTotal: parseFloat(((totalCornereGazde + totalCornereOaspete) / meciuriCuStats).toFixed(1)),
                        peste8_5: peste8_5Cornere,
                        peste9_5: peste9_5Cornere,
                        peste10_5: peste10_5Cornere
                    },
                    cartonase: {
                        galbene: {
                            mediaGazde: parseFloat((totalGalbeneGazde / meciuriCuStats).toFixed(1)),
                            mediaOaspete: parseFloat((totalGalbeneOaspete / meciuriCuStats).toFixed(1)),
                            mediaTotal: parseFloat(((totalGalbeneGazde + totalGalbeneOaspete) / meciuriCuStats).toFixed(1)),
                            peste2: peste2Galbene,
                            peste3: peste3Galbene
                        },
                        rosii: {
                            mediaGazde: parseFloat((totalRosiGazde / meciuriCuStats).toFixed(1)),
                            mediaOaspete: parseFloat((totalRosiOaspete / meciuriCuStats).toFixed(1))
                        }
                    }
                };
            }

            const h2hGroup = h2hData.h2hGroups.find(g => g.title.toUpperCase().includes('MECIURI DIRECTE') || g.title.toUpperCase() === 'H2H');
            const allFormGroups = h2hData.h2hGroups.filter(g => g.title.toUpperCase().includes('ULTIMELE'));
            const formTeam1Group = allFormGroups.length > 0 ? allFormGroups[0] : null;
            const formTeam2Group = allFormGroups.length > 1 ? allFormGroups[1] : null;

            const h2hStatsRaw = calculeazaStatistici(h2hGroup ? h2hGroup.matches : null, team1);
            const form1StatsRaw = calculeazaStatistici(formTeam1Group ? formTeam1Group.matches : null, team1);
            const form2StatsRaw = calculeazaStatistici(formTeam2Group ? formTeam2Group.matches : null, team2);

            const h2hStats = h2hStatsRaw ? {
                totalMeciuriH2H: h2hStatsRaw.totalMeciuri,
                echipaGazda: { nume: team1, victorii: h2hStatsRaw.victoriiEchipa1, goluriMarcate: h2hStatsRaw.goluriEchipa1 },
                echipaOaspete: { nume: team2, victorii: h2hStatsRaw.victoriiEchipa2, goluriMarcate: h2hStatsRaw.goluriEchipa2 },
                egaluri: h2hStatsRaw.egaluri, ambeleMarcheaza: h2hStatsRaw.ambeleMarcheaza,
                peste1_5Goluri: h2hStatsRaw.peste1_5, peste2_5Goluri: h2hStatsRaw.peste2_5
            } : null;

            const formaRecentă = {
                echipaGazda: form1StatsRaw ? {
                    nume: team1, totalMeciuri: form1StatsRaw.totalMeciuri, victorii: form1StatsRaw.victoriiEchipa1,
                    egaluri: form1StatsRaw.egaluri, infrangeri: form1StatsRaw.victoriiEchipa2,
                    goluriMarcate: form1StatsRaw.goluriEchipa1, goluriPrimite: form1StatsRaw.goluriEchipa2,
                    mediaGoluriMarcate: parseFloat((form1StatsRaw.goluriEchipa1 / form1StatsRaw.totalMeciuri).toFixed(2)),
                    mediaGoluriPrimite: parseFloat((form1StatsRaw.goluriEchipa2 / form1StatsRaw.totalMeciuri).toFixed(2)),
                    ambeleMarcheaza: form1StatsRaw.ambeleMarcheaza, peste2_5Goluri: form1StatsRaw.peste2_5, cleanSheets: form1StatsRaw.cleanSheetsEchipa1
                } : null,
                echipaOaspete: form2StatsRaw ? {
                    nume: team2, totalMeciuri: form2StatsRaw.totalMeciuri, victorii: form2StatsRaw.victoriiEchipa1,
                    egaluri: form2StatsRaw.egaluri, infrangeri: form2StatsRaw.victoriiEchipa2,
                    goluriMarcate: form2StatsRaw.goluriEchipa1, goluriPrimite: form2StatsRaw.goluriEchipa2,
                    mediaGoluriMarcate: parseFloat((form2StatsRaw.goluriEchipa1 / form2StatsRaw.totalMeciuri).toFixed(2)),
                    mediaGoluriPrimite: parseFloat((form2StatsRaw.goluriEchipa2 / form2StatsRaw.totalMeciuri).toFixed(2)),
                    ambeleMarcheaza: form2StatsRaw.ambeleMarcheaza, peste2_5Goluri: form2StatsRaw.peste2_5, cleanSheets: form2StatsRaw.cleanSheetsEchipa1
                } : null
            };

            const bets = {};
            const areH2H = h2hStatsRaw && h2hStatsRaw.totalMeciuri > 0;
            const wH2H = areH2H ? 30 : 0;
            const wForm = areH2H ? 35 : 50;

            let ggScore = 0;
            if (areH2H && (h2hStatsRaw.ambeleMarcheaza / h2hStatsRaw.totalMeciuri) >= 0.5) ggScore += wH2H;
            if (form1StatsRaw && form1StatsRaw.totalMeciuri > 0 && (form1StatsRaw.ambeleMarcheaza / form1StatsRaw.totalMeciuri) >= 0.6) ggScore += wForm;
            if (form2StatsRaw && form2StatsRaw.totalMeciuri > 0 && (form2StatsRaw.ambeleMarcheaza / form2StatsRaw.totalMeciuri) >= 0.6) ggScore += wForm;

            // --- Extragere suplimentară a mediilor xG (Expected Goals) din meciurile recente ---
            const toateMeciurileH2H = h2hData.h2hGroups.flatMap(g => g.matches);

            function calculeazaXG(meciuri, numeEchipa) {
                if (!numeEchipa) return null;
                let totalXg = 0;
                let count = 0;
                const baseName = numeEchipa.replace(/\(.*?\)/g, '').trim(); // Scoatem "(CRO)"

                for (const m of meciuri) {
                    if (!m.statisticiMeci || !m.statisticiMeci.total) continue;
                    const xgStat = m.statisticiMeci.total.find(s => s.categorie.includes('xG'));
                    if (xgStat) {
                        if (m.gazde && m.gazde.includes(baseName)) {
                            totalXg += parseFloat(xgStat.gazde || 0);
                            count++;
                        } else if (m.oaspeti && m.oaspeti.includes(baseName)) {
                            totalXg += parseFloat(xgStat.oaspete || 0);
                            count++;
                        }
                    }
                }
                return count > 0 ? (totalXg / count) : null;
            }

            const numeEchipa1 = formaRecentă?.echipaGazda?.nume;
            const numeEchipa2 = formaRecentă?.echipaOaspete?.nume;

            const xgE1 = calculeazaXG(toateMeciurileH2H, numeEchipa1);
            const xgE2 = calculeazaXG(toateMeciurileH2H, numeEchipa2);

            let p25Score = 0;
            let s1Score = 0;
            let s2Score = 0;

            // Ajustăm scorurile (bonusuri) dacă xG-ul susține predicția
            if (xgE1 !== null && xgE2 !== null) {
                if (xgE1 >= 1.5 && xgE2 >= 1.5) ggScore += 20;
                if (xgE1 + xgE2 >= 3.0) p25Score += 20;
                if (xgE1 >= 2.0 && xgE2 <= 1.0) s1Score += 20;
                if (xgE2 >= 2.0 && xgE1 <= 1.0) s2Score += 20;
                if (xgE1 >= 1.8) bets["T1 P0.5"] = 90;
                if (xgE2 >= 1.8) bets["T2 P0.5"] = 90;
            }

            if (ggScore >= 70) bets["GG"] = Math.min(ggScore, 95);

            let ngScore = 0;
            if (areH2H && (h2hStatsRaw.ambeleMarcheaza / h2hStatsRaw.totalMeciuri) <= 0.3) ngScore += wH2H;
            if (form1StatsRaw && form1StatsRaw.totalMeciuri > 0 && (form1StatsRaw.ambeleMarcheaza / form1StatsRaw.totalMeciuri) <= 0.4) ngScore += wForm;
            if (form2StatsRaw && form2StatsRaw.totalMeciuri > 0 && (form2StatsRaw.ambeleMarcheaza / form2StatsRaw.totalMeciuri) <= 0.4) ngScore += wForm;
            if (ngScore >= 75) bets["NG"] = Math.min(ngScore, 95);

            let mediaGoluriForm1 = form1StatsRaw ? (form1StatsRaw.goluriEchipa1 + form1StatsRaw.goluriEchipa2) / form1StatsRaw.totalMeciuri : 0;
            let mediaGoluriForm2 = form2StatsRaw ? (form2StatsRaw.goluriEchipa1 + form2StatsRaw.goluriEchipa2) / form2StatsRaw.totalMeciuri : 0;

            let p15Score = 0;
            let s35Score = 0;

            if (areH2H && (h2hStatsRaw.peste1_5 / h2hStatsRaw.totalMeciuri) >= 0.7) p15Score += wH2H;
            if (form1StatsRaw && (form1StatsRaw.peste1_5 / form1StatsRaw.totalMeciuri) >= 0.7) p15Score += wForm;
            if (form2StatsRaw && (form2StatsRaw.peste1_5 / form2StatsRaw.totalMeciuri) >= 0.7) p15Score += wForm;

            if (areH2H && (h2hStatsRaw.peste2_5 / h2hStatsRaw.totalMeciuri) >= 0.5) p25Score += wH2H;
            if (form1StatsRaw && (form1StatsRaw.peste2_5 / form1StatsRaw.totalMeciuri) >= 0.6) p25Score += wForm;
            if (form2StatsRaw && (form2StatsRaw.peste2_5 / form2StatsRaw.totalMeciuri) >= 0.6) p25Score += wForm;
            if ((mediaGoluriForm1 + mediaGoluriForm2) / 2 > 3.0) p25Score += 15;

            if (areH2H && (h2hStatsRaw.peste2_5 / h2hStatsRaw.totalMeciuri) <= 0.3) s35Score += wH2H;
            if (form1StatsRaw && (form1StatsRaw.peste2_5 / form1StatsRaw.totalMeciuri) <= 0.3) s35Score += wForm;
            if (form2StatsRaw && (form2StatsRaw.peste2_5 / form2StatsRaw.totalMeciuri) <= 0.3) s35Score += wForm;

            if (p25Score >= 70) bets["P2.5"] = Math.min(p25Score, 95);
            else if (p15Score >= 75) bets["P1.5"] = Math.min(p15Score, 95);

            if (s35Score >= 80) bets["S3.5"] = Math.min(s35Score, 95);

            if (areH2H && (h2hStatsRaw.victoriiEchipa1 / h2hStatsRaw.totalMeciuri) >= 0.5) s1Score += wH2H;
            if (form1StatsRaw && (form1StatsRaw.victoriiEchipa1 / form1StatsRaw.totalMeciuri) >= 0.6) s1Score += wForm;
            if (form2StatsRaw && (form2StatsRaw.victoriiEchipa2 / form2StatsRaw.totalMeciuri) >= 0.5) s1Score += wForm;
            if (s1Score >= 70) bets["1"] = Math.min(s1Score, 95);

            if (areH2H && (h2hStatsRaw.victoriiEchipa2 / h2hStatsRaw.totalMeciuri) >= 0.5) s2Score += wH2H;
            if (form2StatsRaw && (form2StatsRaw.victoriiEchipa1 / form2StatsRaw.totalMeciuri) >= 0.6) s2Score += wForm;
            if (form1StatsRaw && (form1StatsRaw.victoriiEchipa2 / form1StatsRaw.totalMeciuri) >= 0.5) s2Score += wForm;
            if (s2Score >= 70) bets["2"] = Math.min(s2Score, 95);

            let s1xScore = 0;
            const w1XH2H = areH2H ? 20 : 0;
            const w1XForm = areH2H ? 40 : 50;
            if (areH2H && (h2hStatsRaw.victoriiEchipa1 + h2hStatsRaw.egaluri) >= h2hStatsRaw.totalMeciuri * 0.5) s1xScore += w1XH2H;
            if (form1StatsRaw && form1StatsRaw.victoriiEchipa2 === 0) s1xScore += w1XForm;
            else if (form1StatsRaw && form1StatsRaw.victoriiEchipa2 === 1) s1xScore += (w1XForm / 2);
            if (form2StatsRaw && form2StatsRaw.victoriiEchipa1 <= 2) s1xScore += w1XForm;
            if (s1xScore >= 75) bets["1X"] = Math.min(s1xScore, 95);

            let sx2Score = 0;
            if (areH2H && (h2hStatsRaw.victoriiEchipa2 + h2hStatsRaw.egaluri) >= h2hStatsRaw.totalMeciuri * 0.5) sx2Score += w1XH2H;
            if (form2StatsRaw && form2StatsRaw.victoriiEchipa2 === 0) sx2Score += w1XForm;
            else if (form2StatsRaw && form2StatsRaw.victoriiEchipa2 === 1) sx2Score += (w1XForm / 2);
            if (form1StatsRaw && form1StatsRaw.victoriiEchipa1 <= 2) sx2Score += w1XForm;
            if (sx2Score >= 75) bets["X2"] = Math.min(sx2Score, 95);

            if (Object.keys(bets).length === 0) {
                bets["N/A"] = "Nu s-au putut extrage pariuri cu încredere >= 70% (Meci imprevizibil)";
            }

            // --- Statistici extinse: Cornere + Cartonașe din toate grupele H2H ---
            const statsExtinseTotal = calculeazaStatisticiExtinse(toateMeciurileH2H, 'total');
            const statsExtinsePrimaRepriza = calculeazaStatisticiExtinse(toateMeciurileH2H, 'primaRepriza');

            // Predicții bazate pe cornere și cartonașe
            const betsExtinse = {};
            if (statsExtinseTotal && statsExtinseTotal.meciuriCuDate >= 3) {
                const c = statsExtinseTotal.cornere;
                const g = statsExtinseTotal.cartonase.galbene;
                const n = statsExtinseTotal.meciuriCuDate;

                // Cornere
                if (c.peste9_5 / n >= 0.6) betsExtinse["Cornere P9.5"] = Math.round((c.peste9_5 / n) * 100);
                else if (c.peste8_5 / n >= 0.7) betsExtinse["Cornere P8.5"] = Math.round((c.peste8_5 / n) * 100);
                if ((n - c.peste8_5) / n >= 0.7) betsExtinse["Cornere S8.5"] = Math.round(((n - c.peste8_5) / n) * 100);
                if (c.peste10_5 / n >= 0.6) betsExtinse["Cornere P10.5"] = Math.round((c.peste10_5 / n) * 100);

                // Cartonașe galbene
                if (g.peste3 / n >= 0.6) betsExtinse["Galbene P3"] = Math.round((g.peste3 / n) * 100);
                if (g.peste2 / n >= 0.7) betsExtinse["Galbene P2"] = Math.round((g.peste2 / n) * 100);
            }

            // Predicții Prima Repriză
            const betsPR = {};
            const prH2H = calculeazaStatistici(h2hData.h2hGroups.find(g => g.title.includes('H2H'))?.matches, numeEchipa1, true);
            const prF1 = calculeazaStatistici(h2hData.h2hGroups.find(g => g.title.includes(numeEchipa1))?.matches, numeEchipa1, true);
            const prF2 = calculeazaStatistici(h2hData.h2hGroups.find(g => g.title.includes(numeEchipa2))?.matches, numeEchipa2, true);

            let prP05Score = 0;
            let prP15Score = 0;
            
            const wPRH2H = prH2H && prH2H.totalMeciuri > 0 ? 30 : 0;
            const wPRForm = prH2H && prH2H.totalMeciuri > 0 ? 35 : 50;

            if (prH2H && prH2H.totalMeciuri > 0 && (prH2H.peste0_5 / prH2H.totalMeciuri) >= 0.7) prP05Score += wPRH2H;
            if (prF1 && prF1.totalMeciuri > 0 && (prF1.peste0_5 / prF1.totalMeciuri) >= 0.7) prP05Score += wPRForm;
            if (prF2 && prF2.totalMeciuri > 0 && (prF2.peste0_5 / prF2.totalMeciuri) >= 0.7) prP05Score += wPRForm;
            
            if (prP05Score >= 70) betsPR["PR P0.5"] = Math.min(prP05Score, 95);

            if (prH2H && prH2H.totalMeciuri > 0 && (prH2H.peste1_5 / prH2H.totalMeciuri) >= 0.4) prP15Score += wPRH2H;
            if (prF1 && prF1.totalMeciuri > 0 && (prF1.peste1_5 / prF1.totalMeciuri) >= 0.4) prP15Score += wPRForm;
            if (prF2 && prF2.totalMeciuri > 0 && (prF2.peste1_5 / prF2.totalMeciuri) >= 0.4) prP15Score += wPRForm;
            
            if (prP15Score >= 70) betsPR["PR P1.5"] = Math.min(prP15Score, 95);

            if (Object.keys(betsPR).length === 0) {
                betsPR["N/A"] = "Nu există predicții sigure pentru prima repriză";
            }

            // Ordonăm obiectul final pentru un JSON perfect formatat
            const dateFinale = {
                urlMeci: h2hUrl,
                matchTitle: h2hData.matchTitle,
                campionat: h2hData.campionat,
                dataOra: h2hData.dataOra,
                scorMeciCurent: h2hData.scorMeciCurent,
                echipaGazdaImg: h2hData.echipaGazdaImg,
                echipaOaspeteImg: h2hData.echipaOaspeteImg,
                statisticiH2H: h2hStats || 'Nu exista date H2H',
                formaRecentă: formaRecentă,
                statisticiExtinse: {
                    total: statsExtinseTotal,
                    primaRepriza: statsExtinsePrimaRepriza
                },
                statisticiGoluriPrimaRepriza: {
                    h2h: calculeazaStatistici(h2hData.h2hGroups.find(g => g.title.includes('H2H'))?.matches, numeEchipa1, true),
                    formaGazda: calculeazaStatistici(h2hData.h2hGroups.find(g => g.title.includes(numeEchipa1))?.matches, numeEchipa1, true),
                    formaOaspete: calculeazaStatistici(h2hData.h2hGroups.find(g => g.title.includes(numeEchipa2))?.matches, numeEchipa2, true)
                },
                meciuriH2H: h2hData.h2hGroups,
                predictii: bets,
                predictiiExtinse: Object.keys(betsExtinse).length > 0 ? betsExtinse : { "N/A": "Date insuficiente pentru cornere/cartonașe" },
                predictiiPrimaRepriza: betsPR
            };



            meciuriProcesate++;
            console.log(`[SUCCES] [${meciuriProcesate}/${matchesToScrape.length}] Date procesate pentru ${dateFinale.matchTitle}`);
            return dateFinale;
        } catch (error) {
            meciuriProcesate++;
            console.error(`[EROARE] [${meciuriProcesate}/${matchesToScrape.length}] La meciul ${h2hUrl}:`, error.message);
            return null;
        }
    }

    // Optimizare: Folosim o coadă de workeri (Worker Queue) și refolosim paginile 
    // pentru a evita overhead-ul deschiderii/închiderii de tab-uri pentru fiecare meci.
    const MAX_CONCURRENT = 2;
    console.log(`Creăm ${MAX_CONCURRENT} pagini worker pentru procesare paralelă...`);

    const workerPages = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
        const p = await browser.newPage();
        await p.setRequestInterception(true);
        p.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });
        workerPages.push(p);
    }

    let currentIndex = 0;

    function salveazaMeciSync() {
        try {
            fs.writeFileSync(fisierDate, JSON.stringify(statistics, null, 2), 'utf8');
        } catch (error) {
            console.error(`Eroare la salvarea fișierului ${fisierDate}:`, error.message);
        }
    }

    async function worker(workerId) {
        const p = workerPages[workerId];
        while (currentIndex < matchesToScrape.length) {
            const taskIndex = currentIndex++;
            const url = matchesToScrape[taskIndex];
            const result = await proceseazaMeci(url, p);
            if (result) {
                const idx = statistics.findIndex(m => m.urlMeci === result.urlMeci);
                if (idx !== -1) {
                    statistics[idx] = result; // Actualizăm meciul existent
                } else {
                    statistics.push(result); // Adăugăm meci nou
                }
                salveazaMeciSync();
            }
        }
    }

    // Lansăm workerii în paralel
    const workers = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);

    // Închidem paginile worker-ilor după terminare
    for (const p of workerPages) {
        try { await p.close(); } catch (_) { }
    }

    console.log('\n=============================================');
    console.log('STATISTICI EXTRASE:');
    console.log('=============================================');
    console.log(`\nToate datele au fost salvate treptat în ${fisierDate}`);

    console.log('\nAm terminat procesarea. Închidem browser-ul...');
    try { await browser.close(); } catch (_) { }

})();
