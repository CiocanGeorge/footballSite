const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // Meci terminat cu statistici disponibile
    const url = 'https://www.flashscore.ro/meci/fotbal/fram-K2xtlHng/kr-reykjavik-6aYykcXn/h2h/total/?mid=EqdjXsie';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    const result = await page.evaluate(() => {
        // Statisticile sunt sub [data-testid*="wcl-statistics"]
        const statEls = document.querySelectorAll('[data-testid*="wcl-statistics"]');
        const parsed = [];
        statEls.forEach(el => {
            parsed.push({
                testid: el.getAttribute('data-testid'),
                html: el.innerHTML.substring(0, 500),
                text: el.innerText.substring(0, 300)
            });
        });

        // Încercăm și categoriile individuale
        const statCategories = document.querySelectorAll('[data-testid="wcl-statistics-category"]');
        const categories = [];
        statCategories.forEach(cat => {
            categories.push({
                text: cat.innerText,
                children: Array.from(cat.children).map(c => ({ tag: c.tagName, testid: c.getAttribute('data-testid'), text: c.innerText.substring(0, 100) }))
            });
        });

        return { parsed: parsed.slice(0, 10), categories: categories.slice(0, 20) };
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
})();
