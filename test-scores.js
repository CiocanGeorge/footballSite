const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://www.flashscore.ro/', { waitUntil: 'domcontentloaded' });
    
    // Accept cookies
    try {
        await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000 });
        await page.click('#onetrust-accept-btn-handler');
    } catch(e) {}
    
    // Click prev day
    try {
        const prevBtnSelector = 'button[data-day-picker-arrow="prev"], button[aria-label="Ziua precedentă"]';
        await page.waitForSelector(prevBtnSelector, { timeout: 5000 });
        await page.evaluate((sel) => document.querySelector(sel).click(), prevBtnSelector);
        await new Promise(r => setTimeout(r, 4000));
    } catch(e) {}
    
    // Extract scores
    const matches = await page.evaluate(() => {
        const rows = document.querySelectorAll('.event__match');
        const res = [];
        rows.forEach(r => {
            const h = r.querySelector('.event__participant--home')?.innerText.trim();
            const a = r.querySelector('.event__participant--away')?.innerText.trim();
            const sh = r.querySelector('.event__score--home')?.innerText.trim();
            const sa = r.querySelector('.event__score--away')?.innerText.trim();
            const stage = r.querySelector('.event__stage')?.innerText.trim() || '';
            if(h && a) {
                res.push({ match: `${h} vs ${a}`, score: `${sh} - ${sa} (${stage})` });
            }
        });
        return res;
    });
    
    console.log(`Extracted ${matches.length} matches`);
    if(matches.length > 0) {
        console.log(matches.slice(0, 5));
    }
    
    await browser.close();
})();
