const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const url = 'https://www.flashscore.ro/meci/fotbal/iberia-1999-dhfRkskl/jagiellonia-lIDaZJTc/sumar/statistici/1/?mid=8fhEgxXA';
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    const info = await page.evaluate(() => {
        const smH = document.querySelector('.smv__incidentsHeader');
        const detailScore = document.querySelector('.detailScore__wrapper');
        const smv = document.querySelectorAll('.smv__incidentsHeader'); const result = smv.length ? Array.from(smv).map(e => e.innerText) : [];
        return {
            html: document.body.innerHTML.substring(0, 5000), // Too big, let's just grab text of interesting parts
            detailScoreText: detailScore ? detailScore.innerText : null,
            htText: result
        };
    });

    console.log(JSON.stringify(info, null, 2));
    await browser.close();
})();
