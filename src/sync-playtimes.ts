import 'dotenv/config';
import { mkdir, access, writeFile } from 'node:fs/promises';
import { chromium, type Page, type BrowserContext, type Locator } from 'playwright';
import { collapseSpaces, durationToMinutes, getReferenceDate, normalizeText, toDisplayDuration, type GamePlaytime } from './domain.js';
import { loginIfNeeded, scrapeSessions } from './ps-timetracker.js';

const BACKLOGGD_DEFAULT_ORIGIN = 'https://backloggd.com';
let BACKLOGGD_ACTIVE_ORIGIN = BACKLOGGD_DEFAULT_ORIGIN;
const BACKLOGGD_STORAGE_STATE_PATH = process.env.BACKLOGGD_STORAGE_STATE_PATH;
const SYNC_SUMMARY_PATH = process.env.SYNC_SUMMARY_PATH ?? 'storage/sync-summary.json';
const HEADLESS = process.env.HEADLESS !== 'false';
const REFERENCE_DATE = getReferenceDate();
const DEBUG_SYNC = process.env.SYNC_DEBUG === 'true';
const BACKLOGGD_CONTEXT_OPTIONS = {
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  timezoneId: 'America/Sao_Paulo',
  colorScheme: 'light' as const,
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
  javaScriptEnabled: true,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isBackloggdHost(hostname: string): boolean {
  return hostname === 'backloggd.com' || hostname === 'www.backloggd.com' || hostname.endsWith('.backloggd.com');
}

function updateBackloggdOriginFromUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (isBackloggdHost(parsed.hostname)) {
      BACKLOGGD_ACTIVE_ORIGIN = parsed.origin;
    }
  } catch {
    // Ignore invalid or non-absolute URLs.
  }
}

function backloggdUrl(path: string): string {
  return new URL(path, `${BACKLOGGD_ACTIVE_ORIGIN}/`).toString();
}

type SyncSummaryGame = {
  title: string;
  playedTime: string;
  registeredDay: string;
};

type SyncSummary = {
  generatedAt: string;
  referenceDate: string;
  totalGames: number;
  games: SyncSummaryGame[];
};

function toDdMmYyyy(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function parentDir(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash < 0) {
    return '.';
  }

  const dir = path.slice(0, lastSlash);
  return dir || '.';
}

async function writeSyncSummary(games: GamePlaytime[]): Promise<void> {
  const registeredDay = toDdMmYyyy(REFERENCE_DATE);
  const summary: SyncSummary = {
    generatedAt: new Date().toISOString(),
    referenceDate: REFERENCE_DATE.toISOString().slice(0, 10),
    totalGames: games.length,
    games: games.map((game) => ({
      title: game.title,
      playedTime: toDisplayDuration(durationToMinutes(game.hours, game.minutes)),
      registeredDay
    }))
  };

  await mkdir(parentDir(SYNC_SUMMARY_PATH), { recursive: true }).catch(() => undefined);
  await writeFile(SYNC_SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (DEBUG_SYNC) {
    console.log(`Saved sync summary at ${SYNC_SUMMARY_PATH}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForBackloggdReady(page: Page, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const challengeVisible = await page.getByText(/hold tight|secure connection|checking your browser/i).isVisible().catch(() => false);
    const onChallengePage =
      url.includes('/.bunny-shield/') ||
      /establishing a secure connection/i.test(title) ||
      challengeVisible;

    if (!onChallengePage) {
      return;
    }

    if (DEBUG_SYNC) {
      console.log(`Backloggd challenge detected (${Math.round((Date.now() - start) / 1000)}s). Waiting...`);
    }

    await page.waitForTimeout(1_000);
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  }

  throw new Error('Backloggd challenge did not clear in time. Retry later or run once with HEADLESS=false to validate access.');
}

async function waitForBackloggdAuthSurface(page: Page, timeoutMs = 120_000): Promise<'session' | 'login-form'> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await waitForBackloggdReady(page, 15_000).catch(() => undefined);

    if (await hasBackloggdSession(page)) {
      return 'session';
    }

    const emailVisible = await page.locator('#user_login, input[name="user[login]"]').first().isVisible().catch(() => false);
    const passwordVisible = await page.locator('#user_password, input[name="user[password]"]').first().isVisible().catch(() => false);

    if (emailVisible && passwordVisible) {
      return 'login-form';
    }

    if (DEBUG_SYNC) {
      console.log(`Waiting Backloggd auth surface (${Math.round((Date.now() - start) / 1000)}s)...`);
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(
    `Backloggd auth surface not available at ${page.url()}. Current title: ${await page
      .title()
      .catch(() => 'unknown')}. If Bunny Shield keeps blocking automation, run once with HEADLESS=false and reuse BACKLOGGD_STORAGE_STATE_PATH.`
  );
}

async function hasBackloggdSession(page: Page): Promise<boolean> {
  const quickLogVisible = await page.getByText(/quick log/i).isVisible().catch(() => false);
  if (quickLogVisible) {
    return true;
  }

  const logOutVisible = await page.getByRole('link', { name: /log out/i }).first().isVisible().catch(() => false);
  if (logOutVisible) {
    return true;
  }

  const profileDropdownVisible = await page.locator('#profile-li, #navbarDropdown').first().isVisible().catch(() => false);
  if (profileDropdownVisible) {
    return true;
  }

  const addGameVisible = await page.locator('#add-a-game').isVisible().catch(() => false);
  return addGameVisible;
}

async function ensureBackloggdSession(page: Page): Promise<void> {
  await page.goto(backloggdUrl('/login/'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const loginSurface = await waitForBackloggdAuthSurface(page);
  updateBackloggdOriginFromUrl(page.url());

  const loggedIn = loginSurface === 'session' || (await hasBackloggdSession(page));
  if (loggedIn) {
    await page.goto(backloggdUrl('/u/henriquetavares/playing/'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await waitForBackloggdReady(page).catch(() => undefined);
    updateBackloggdOriginFromUrl(page.url());

    const stillAuthenticated = await hasBackloggdSession(page);
    if (!stillAuthenticated) {
      throw new Error('Backloggd session was expected but not confirmed on playing page.');
    }
    return;
  }

  const email = requireEnv('BACKLOGGD_EMAIL');
  const password = requireEnv('BACKLOGGD_PWD');

  const emailInput = page.locator('#user_login, input[name="user[login]"]').first();
  const passwordInput = page.locator('#user_password, input[name="user[password]"]').first();
  const rememberMeInput = page.locator('#user_remember_me, input[name="user[remember_me]"]').first();
  const loginButton = page.locator('#log-in-btn, button[name="commit"]').first();

  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  if (await rememberMeInput.count()) {
    await rememberMeInput.check({ force: true }).catch(() => undefined);
  }

  await loginButton.waitFor({ state: 'visible', timeout: 15_000 });
  await loginButton.click({ force: true });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForBackloggdAuthSurface(page);

  await page.goto(backloggdUrl('/u/henriquetavares/playing/'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForBackloggdReady(page).catch(() => undefined);
  updateBackloggdOriginFromUrl(page.url());

  const bouncedToLogin = /\/login\/?$/i.test(new URL(page.url()).pathname);
  const playingGridVisible = await page.locator('#game-lists').first().isVisible().catch(() => false);
  const sessionActive = await hasBackloggdSession(page);

  if (bouncedToLogin || (!playingGridVisible && !sessionActive)) {
    const currentTitle = await page.title().catch(() => 'unknown');
    throw new Error(
      `Backloggd login did not activate a usable session. url=${page.url()} title=${currentTitle} bouncedToLogin=${String(
        bouncedToLogin
      )} playingGridVisible=${String(playingGridVisible)} sessionActive=${String(sessionActive)}`
    );
  }
}

async function loginBackloggdFromGame(page: Page, returnUrl: string): Promise<void> {
  const email = requireEnv('BACKLOGGD_EMAIL');
  const password = requireEnv('BACKLOGGD_PWD');

  const loginLink = page.locator('a.nav-link[href="/login/"], a[href="/login/"]').first();
  if (await loginLink.count()) {
    await loginLink.click({ force: true });
  } else {
    await page.goto(backloggdUrl('/login/'), { waitUntil: 'domcontentloaded' });
  }

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForBackloggdAuthSurface(page);
  updateBackloggdOriginFromUrl(page.url());

  if (!(await hasBackloggdSession(page))) {
    const emailInput = page.locator('#user_login, input[name="user[login]"]').first();
    const passwordInput = page.locator('#user_password, input[name="user[password]"]').first();
    const rememberMeInput = page.locator('#user_remember_me, input[name="user[remember_me]"]').first();
    const loginButton = page.locator('#log-in-btn, button[name="commit"]').first();

    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await emailInput.fill(email);
    await passwordInput.fill(password);

    if (await rememberMeInput.count()) {
      await rememberMeInput.check({ force: true }).catch(() => undefined);
    }

    await loginButton.waitFor({ state: 'visible', timeout: 15_000 });
    await loginButton.click({ force: true });
    // Backloggd may not redirect immediately after login submit.
    await page.waitForTimeout(5_000);
  }

  await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForBackloggdReady(page).catch(() => undefined);
  updateBackloggdOriginFromUrl(page.url());

  const bouncedToLogin = /\/login\/?$/i.test(new URL(page.url()).pathname);
  if (bouncedToLogin || !(await hasBackloggdSession(page))) {
    const currentTitle = await page.title().catch(() => 'unknown');
    throw new Error(`Backloggd login from game page failed. url=${page.url()} title=${currentTitle}`);
  }
}

async function findPlayingGameCard(page: Page, title: string) {
  const normalizedTitle = normalizeText(title);
  const posters = page.locator('#game-lists .card.game-cover');
  const count = await posters.count();
  const compactTitle = normalizedTitle.replace(/[^a-z0-9]+/g, '');

  for (let index = 0; index < Math.min(count, 500); index += 1) {
    const candidate = posters.nth(index);
    const candidateText = (await candidate.textContent().catch(() => '')) ?? '';
    const imageAlt = normalizeText((await candidate.locator('img').first().getAttribute('alt').catch(() => '')) ?? '');
    const aria = normalizeText((await candidate.getAttribute('aria-label')) ?? '');
    const titleAttr = normalizeText((await candidate.getAttribute('title')) ?? '');
    const href = normalizeText((await candidate.locator('a').first().getAttribute('href').catch(() => '')) ?? '');
    const haystack = [normalizeText(candidateText), imageAlt, aria, titleAttr, href].join(' ');
    if (!haystack) {
      continue;
    }

    if (haystack === normalizedTitle || haystack.includes(normalizedTitle)) {
      return candidate;
    }

    const compactHaystack = haystack.replace(/[^a-z0-9]+/g, '');
    if (compactHaystack.includes(compactTitle)) {
      return candidate;
    }
  }

  return null;
}

function getMonthIndex(monthName: string): number {
  const names = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december'
  ];

  return names.indexOf(monthName.toLowerCase());
}

async function alignCalendarToReferenceDate(page: Page): Promise<void> {
  const targetYear = REFERENCE_DATE.getFullYear();
  const targetMonth = REFERENCE_DATE.getMonth();

  for (let attempts = 0; attempts < 24; attempts += 1) {
    const monthText = collapseSpaces(
      (await page
        .locator('#playthrough-calendar button[data-id="month-selector"] .filter-option-inner-inner, button[data-id="month-selector"] .filter-option-inner-inner')
        .first()
        .innerText()
        .catch(() => '')) ||
        (await page
          .locator('#playthrough-calendar button[data-id="month-selector"], button[data-id="month-selector"]')
          .first()
          .getAttribute('title')
          .catch(() => '')) ||
        ''
    );
    const yearText = collapseSpaces(
      (await page
        .locator('#playthrough-calendar button[data-id="year-selector"] .filter-option-inner-inner, button[data-id="year-selector"] .filter-option-inner-inner')
        .first()
        .innerText()
        .catch(() => '')) ||
        (await page
          .locator('#playthrough-calendar button[data-id="year-selector"], button[data-id="year-selector"]')
          .first()
          .getAttribute('title')
          .catch(() => '')) ||
        ''
    );

    const shownMonth = getMonthIndex(monthText);
    const shownYear = Number.parseInt(yearText, 10);

    if (shownMonth === targetMonth && shownYear === targetYear) {
      return;
    }

    if (shownMonth < 0 || !Number.isFinite(shownYear)) {
      throw new Error(`Could not read Backloggd calendar month/year (month="${monthText}", year="${yearText}").`);
    }

    const shouldGoNext = shownYear < targetYear || (shownYear === targetYear && shownMonth < targetMonth);
    await page.locator(shouldGoNext ? '#month-next' : '#month-prev').first().click({ force: true });
    await page.waitForTimeout(250);
  }

  throw new Error('Could not align Backloggd calendar to target month/year.');
}

async function ensureJournalCalendarVisible(page: Page): Promise<void> {
  const calendar = page.locator('#log-editor-full #playthrough-calendar, #playthrough-calendar').first();
  if (await calendar.isVisible().catch(() => false)) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForBackloggdReady(page, 15_000).catch(() => undefined);

    const fullEditorToggle = page
      .locator('#switch-editor-to-full, button:has-text("Full Editor"), button:has-text("Switch to Full")')
      .first();
    if ((await fullEditorToggle.count()) && (await fullEditorToggle.isVisible().catch(() => false))) {
      await fullEditorToggle.click({ force: true });
      await page.waitForTimeout(300);
    }

    const journalNav = page
      .locator('#journal-nav[editor_section="journal"], .journal-section-nav#journal-nav, #journal-nav, .journal-section-nav[editor_section="journal"], [editor_section="journal"]')
      .first();
    if ((await journalNav.count()) && (await journalNav.isVisible().catch(() => false))) {
      await journalNav.click({ force: true });
      await page.waitForTimeout(300);
    }

    if (await calendar.isVisible().catch(() => false)) {
      return;
    }

    await page.waitForTimeout(800);
  }

  await calendar.waitFor({ state: 'visible', timeout: 20_000 });
}

async function confirmPlayDateSaved(page: Page, playDateModal: Locator): Promise<void> {
  // Saving a play date is asynchronous; avoid proceeding while the modal is still mid-submit.
  await playDateModal.waitFor({ state: 'hidden', timeout: 12_000 }).catch(() => undefined);

  const stillVisible = await playDateModal.isVisible().catch(() => false);
  if (stillVisible) {
    throw new Error('Play date modal remained open after clicking save. The playtime update was likely not persisted.');
  }

  await page.waitForTimeout(500);
}

async function confirmJournalSaved(page: Page, gameUrl: string): Promise<void> {
  const journalModal = page.locator('#journal-game-modal').first();
  await journalModal.waitFor({ state: 'hidden', timeout: 12_000 }).catch(() => undefined);

  const stillVisible = await journalModal.isVisible().catch(() => false);
  if (stillVisible) {
    throw new Error('Journal modal remained open after clicking save log. Backloggd may not have persisted the update.');
  }

  await page.waitForTimeout(500);

  await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForBackloggdReady(page).catch(() => undefined);
  updateBackloggdOriginFromUrl(page.url());

  const logEditorButton = page.locator('button.log-editor-btn, .log-editor-btn').first();
  await logEditorButton.waitFor({ state: 'visible', timeout: 15_000 });
}

async function openGameLogEditor(page: Page, title: string): Promise<void> {
  await page.goto(backloggdUrl('/u/henriquetavares/playing/'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForBackloggdReady(page);
  updateBackloggdOriginFromUrl(page.url());

  await page.locator('#game-lists').first().waitFor({ state: 'visible', timeout: 20_000 });

  const target = await findPlayingGameCard(page, title);
  if (!target) {
    throw new Error(`Game not found on Backloggd playing page: ${title}`);
  }

  const coverLink = target.locator('a.cover-link').first();
  const rawGameHref = (await coverLink.getAttribute('href').catch(() => null)) ?? '';
  await coverLink.click({ force: true });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  updateBackloggdOriginFromUrl(page.url());

  let gameUrl = page.url();
  const currentPath = (() => {
    try {
      return new URL(gameUrl).pathname;
    } catch {
      return '';
    }
  })();

  if (!/\/games\//i.test(currentPath) && rawGameHref) {
    const forcedGameUrl = new URL(rawGameHref, `${BACKLOGGD_ACTIVE_ORIGIN}/`).toString();
    await page.goto(forcedGameUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await waitForBackloggdReady(page).catch(() => undefined);
    updateBackloggdOriginFromUrl(page.url());
    gameUrl = page.url();
  }

  const gamePath = (() => {
    try {
      return new URL(gameUrl).pathname;
    } catch {
      return '';
    }
  })();

  if (!/\/games\//i.test(gamePath)) {
    throw new Error(`Could not open Backloggd game page for ${title}. currentUrl=${gameUrl}`);
  }

  if (!(await hasBackloggdSession(page))) {
    if (DEBUG_SYNC) {
      console.log(`Backloggd session missing on game page (${gameUrl}). Logging in from game nav link...`);
    }
    await loginBackloggdFromGame(page, gameUrl);
  }

  const logEditorButton = page.locator('button.log-editor-btn, .log-editor-btn').first();
  await logEditorButton.waitFor({ state: 'visible', timeout: 20_000 });
  await logEditorButton.click({ force: true });

  const fullEditorToggle = page.locator('#switch-editor-to-full').first();
  if (await fullEditorToggle.count()) {
    await fullEditorToggle.waitFor({ state: 'visible', timeout: 20_000 });
    await fullEditorToggle.click({ force: true });
  }

  const fullEditor = page.locator('#journal-game-modal .modal-body[type="full"], #log-editor-full').first();
  await fullEditor.waitFor({ state: 'visible', timeout: 20_000 });
}

async function logPlaySession(page: Page, game: GamePlaytime): Promise<void> {
  await openGameLogEditor(page, game.title);
  await ensureJournalCalendarVisible(page);

  await alignCalendarToReferenceDate(page);

  const targetIsoDate = REFERENCE_DATE.toISOString().slice(0, 10);
  const dayCell = page.locator(`#playthrough-calendar td.fc-day[data-date="${targetIsoDate}"]`).first();
  await dayCell.waitFor({ state: 'visible', timeout: 15_000 });
  await dayCell.click({ force: true });

  const playDateModal = page.locator('#playthrough-modal-content, #playthrough-modal .modal__content').first();
  let clickedSpecificDayEvent = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clickedDayEvent = await page
      .evaluate((isoDate) => {
        const dayTop = document.querySelector(`#playthrough-calendar td.fc-day-top[data-date="${isoDate}"]`);
        if (!dayTop) {
          return false;
        }

        const topRow = dayTop.parentElement;
        if (!topRow) {
          return false;
        }

        const dayIndex = Array.from(topRow.children).indexOf(dayTop);
        if (dayIndex < 0) {
          return false;
        }

        const weekRow = topRow.closest('.fc-content-skeleton')?.parentElement;
        const eventsRow = weekRow?.querySelector('.fc-content-skeleton tbody tr');
        const eventCell = eventsRow?.children.item(dayIndex) as HTMLElement | null;
        const eventLink = eventCell?.querySelector('a.fc-day-grid-event') as HTMLElement | null;

        if (!eventCell || !eventLink) {
          return false;
        }

        // Click only the event cell for the selected day/column.
        eventCell.click();
        eventLink.click();
        return true;
      }, targetIsoDate)
      .catch(() => false);
    clickedSpecificDayEvent = clickedSpecificDayEvent || clickedDayEvent;

    const modalVisible = await playDateModal.isVisible().catch(() => false);
    if (modalVisible) {
      break;
    }

    await page.waitForTimeout(250);
  }

  if (!clickedSpecificDayEvent) {
    throw new Error(`Could not find the specific day event cell for ${targetIsoDate}.`);
  }

  await playDateModal.waitFor({ state: 'visible', timeout: 20_000 });

  const gameUrl = page.url();

  const hoursInput = playDateModal.locator('#play_date_hours').first();
  const minutesInput = playDateModal.locator('#play_date_minutes').first();
  await hoursInput.waitFor({ state: 'visible', timeout: 15_000 });
  await minutesInput.waitFor({ state: 'visible', timeout: 15_000 });

  await hoursInput.fill(String(game.hours));
  await minutesInput.fill(String(game.minutes));

  const playDateSaveButton = playDateModal.locator('#play-date-update').first();
  await playDateSaveButton.waitFor({ state: 'visible', timeout: 15_000 });
  await playDateSaveButton.click({ force: true });
  await confirmPlayDateSaved(page, playDateModal);

  const saveLogButton = page.locator('#btn-save-log .save-log, button.save-log').first();
  await saveLogButton.waitFor({ state: 'visible', timeout: 20_000 });
  await saveLogButton.click({ force: true });
  await confirmJournalSaved(page, gameUrl);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const canReuseState = BACKLOGGD_STORAGE_STATE_PATH && (await fileExists(BACKLOGGD_STORAGE_STATE_PATH));
  const context: BrowserContext = await browser.newContext(
    canReuseState
      ? {
          storageState: BACKLOGGD_STORAGE_STATE_PATH,
          ...BACKLOGGD_CONTEXT_OPTIONS
        }
      : BACKLOGGD_CONTEXT_OPTIONS
  );
  const page = await context.newPage();

  try {
    console.log('Scraping PS-Timetracker playtimes...');
    await loginIfNeeded(page);
    const games = await scrapeSessions(page, { referenceDate: REFERENCE_DATE, debug: DEBUG_SYNC });
    console.log(`Found ${games.length} aggregated game(s): ${games.map((game) => `${game.title} (${game.hours}h ${game.minutes}m)`).join(', ') || 'none'}`);
    await writeSyncSummary(games);

    if (games.length === 0) {
      console.log('No sessions found for today. Nothing to sync.');
      return;
    }

    console.log('Opening Backloggd playing page without initial login...');

    for (const game of games) {
      console.log(`Syncing ${game.title} -> ${toDisplayDuration(durationToMinutes(game.hours, game.minutes))}`);
      try {
        await page.goto(backloggdUrl('/u/henriquetavares/playing/'), { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await waitForBackloggdReady(page);
        updateBackloggdOriginFromUrl(page.url());
        await logPlaySession(page, game);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed syncing ${game.title}: ${message}`);
      }

      if (BACKLOGGD_STORAGE_STATE_PATH) {
        const lastSlash = BACKLOGGD_STORAGE_STATE_PATH.lastIndexOf('/');
        const dir = lastSlash >= 0 ? BACKLOGGD_STORAGE_STATE_PATH.slice(0, lastSlash) : '.';
        if (dir) {
          await mkdir(dir, { recursive: true }).catch(() => undefined);
        }
        await context.storageState({ path: BACKLOGGD_STORAGE_STATE_PATH });
        if (DEBUG_SYNC) {
          console.log(`Saved Playwright storage state at ${BACKLOGGD_STORAGE_STATE_PATH}`);
        }
      }

      console.log(`Synced ${game.title} successfully.`);
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});