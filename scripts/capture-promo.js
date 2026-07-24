const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:'new',
    args:['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1920, deviceScaleFactor:1 });
  await page.goto('http://localhost:5173/promo.html?v=1', { waitUntil:'networkidle0' });
  const fps = 15;
  const total = 20 * fps;
  for (let frame = 0; frame < total; frame++) {
    await page.evaluate(seconds => window.setPhase(seconds), frame / fps);
    await new Promise(resolve => setTimeout(resolve, 90));
    await page.screenshot({ path:`docs/video-frames/frame-${String(frame).padStart(4,'0')}.png` });
  }
  await browser.close();
})();
