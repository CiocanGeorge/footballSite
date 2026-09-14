const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://www.flashscore.ro/', { waitUntil: 'domcontentloaded' });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await page.evaluate(() => {
        const divs = Array.from(document.querySelectorAll('div, button, a, span'));
        const matches = [];
        for (let el of divs) {
            if (el.innerText && el.innerText.trim().toLowerCase() === 'ieri') {
                matches.push(el.outerHTML);
            }
        }
        
        const arrowL = document.querySelector('.calendar__direction--yesterday, .calendar__direction');
        return {
            matches,
            arrowL: arrowL ? arrowL.outerHTML : null
        };
    });
    
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
})();
