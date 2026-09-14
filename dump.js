const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://www.flashscore.ro/', { waitUntil: 'networkidle2' });

    try {
        await page.waitForSelector('.event__match', { timeout: 10000 });
        const html = await page.evaluate(() => {
            return document.querySelector('.event__match').outerHTML;
        });
        console.log("HTML DUMP HOMEPAGE MATCH:");
        console.log(html);
    } catch (e) {
        console.log("Error:", e);
    }
    await browser.close();
})();
