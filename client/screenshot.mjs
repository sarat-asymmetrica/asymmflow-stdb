import puppeteer from 'puppeteer';

const BASE = 'http://localhost:5199';
const OUT = './screenshots';

/**
 * Bypass the OnboardingGate that blocks the UI when STDB has no member record.
 * Strategy: remove the gate overlay, unhide the app shell, then navigate via nav buttons.
 */
async function bypassOnboardingGate(page) {
  await page.evaluate(() => {
    // Remove the fixed onboarding overlay
    const gate = document.querySelector('.onboarding-backdrop');
    if (gate) gate.remove();

    // Unhide the app shell
    const shell = document.querySelector('.app-shell');
    if (shell) {
      shell.classList.remove('app-hidden');
      shell.removeAttribute('aria-hidden');
    }
  });
  // Let Svelte re-render after DOM manipulation
  await new Promise(r => setTimeout(r, 500));
}

function clickNav(label) {
  return (page) => page.evaluate((lbl) => {
    const buttons = document.querySelectorAll('nav button, .sidebar-nav button');
    for (const btn of buttons) {
      if (btn.textContent?.includes(lbl)) { btn.click(); return true; }
    }
    return false;
  }, label);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Navigate to the app
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  // Bypass the onboarding gate
  await bypassOnboardingGate(page);

  // Screenshot 1: Default chat view (after gate bypass)
  await page.screenshot({ path: `${OUT}/01_chat_view.png`, fullPage: false });
  console.log('✓ 01_chat_view.png');

  // Navigate to Dashboard
  await clickNav('Dashboard')(page);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/02_dashboard.png`, fullPage: false });
  console.log('✓ 02_dashboard.png');

  // Navigate to Showcase
  await clickNav('Showcase')(page);
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/03_showcase_top.png`, fullPage: false });
  console.log('✓ 03_showcase_top.png');

  // Scroll down to see buttons + inputs sections
  await page.evaluate(() => {
    const main = document.querySelector('.content-area');
    if (main) main.scrollBy(0, 600);
    else window.scrollBy(0, 600);
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/04_showcase_cards.png`, fullPage: false });
  console.log('✓ 04_showcase_cards.png');

  // Scroll more to KPIs + badges
  await page.evaluate(() => {
    const main = document.querySelector('.content-area');
    if (main) main.scrollBy(0, 500);
    else window.scrollBy(0, 500);
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/05_showcase_kpis.png`, fullPage: false });
  console.log('✓ 05_showcase_kpis.png');

  // Scroll to spinners + scroll reveal
  await page.evaluate(() => {
    const main = document.querySelector('.content-area');
    if (main) main.scrollBy(0, 500);
    else window.scrollBy(0, 500);
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/06_showcase_bottom.png`, fullPage: false });
  console.log('✓ 06_showcase_bottom.png');

  // Trigger all scroll-reveal elements (IO doesn't fire reliably in headless)
  await page.evaluate(() => {
    document.querySelectorAll('.reveal-card, [style*="--reveal-delay"]').forEach(el => {
      el.classList.add('revealed');
    });
  });
  await new Promise(r => setTimeout(r, 800));

  // Full page screenshot of showcase
  await page.screenshot({ path: `${OUT}/07_showcase_full.png`, fullPage: true });
  console.log('✓ 07_showcase_full.png');

  // Navigate to Finance hub
  await clickNav('Finance')(page);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/08_finance_hub.png`, fullPage: false });
  console.log('✓ 08_finance_hub.png');

  // Navigate to Sales
  await clickNav('Sales')(page);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/09_sales_hub.png`, fullPage: false });
  console.log('✓ 09_sales_hub.png');

  // Navigate to Operations
  await clickNav('Operations')(page);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/10_operations_hub.png`, fullPage: false });
  console.log('✓ 10_operations_hub.png');

  // Navigate to Customers (CRM)
  await clickNav('Customers')(page);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/11_crm_hub.png`, fullPage: false });
  console.log('✓ 11_crm_hub.png');

  // Screenshot the onboarding gate itself (reload without bypass)
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/12_onboarding_gate.png`, fullPage: false });
  console.log('✓ 12_onboarding_gate.png');

  await browser.close();
  console.log('\nAll 12 screenshots saved to ./screenshots/');
}

main().catch(e => { console.error(e); process.exit(1); });
