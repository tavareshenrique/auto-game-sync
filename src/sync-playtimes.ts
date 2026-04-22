import 'dotenv/config';
import { mkdir, access } from 'node:fs/promises';
import { chromium, type Page, type BrowserContext, type Locator } from 'playwright';

type GamePlaytime = {
  title: string;
  hours: number;
  minutes: number;
};

type RawSession = {
  title: string;
  minutes: number;
  startedAt?: Date;
};

const PLAYTIMES_URL = 'https://ps-timetracker.com/profile/HTavares97/playtimes';
const BACKLOGGD_DEFAULT_ORIGIN = 'https://backloggd.com';
let BACKLOGGD_ACTIVE_ORIGIN = BACKLOGGD_DEFAULT_ORIGIN;
const BACKLOGGD_STORAGE_STATE_PATH = process.env.BACKLOGGD_STORAGE_STATE_PATH;
const PSN_NAME = process.env.PS_TIMETRACKER_PSN_NAME ?? 'HTavares97';
const HEADLESS = process.env.HEADLESS !== 'false';
const REFERENCE_DATE = getReferenceDate();
const DEBUG_SYNC = process.env.SYNC_DEBUG === 'true';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

function getReferenceDate(): Date {
  const referenceDateValue = process.env.SYNC_REFERENCE_DATE;
  const referenceOffsetValue = process.env.SYNC_REFERENCE_DAYS_OFFSET;

  if (referenceDateValue) {
    const parsed = new Date(referenceDateValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid SYNC_REFERENCE_DATE value: ${referenceDateValue}`);
    }

    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  if (referenceOffsetValue) {
    const offsetDays = Number(referenceOffsetValue);
    if (!Number.isFinite(offsetDays)) {
      throw new Error(`Invalid SYNC_REFERENCE_DAYS_OFFSET value: ${referenceOffsetValue}`);
    }

    const now = new Date();
    const offsetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    offsetDate.setDate(offsetDate.getDate() + offsetDays);
    return offsetDate;
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function durationToMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

function minutesToDuration(totalMinutes: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60
  };
}

function parseDuration(text: string): number | null {
  const normalized = text.replace(/\s+/g, ' ').trim();

  const hhmmMatch = normalized.match(/(\d+)\s*:\s*(\d{1,2})\s*hours?/i);
  if (hhmmMatch) {
    const hours = Number(hhmmMatch[1]);
    const minutes = Number(hhmmMatch[2]);

    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return durationToMinutes(hours, minutes);
    }
  }

  const hourMatch = normalized.match(/(\d+)\s*hours?/i);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours)) {
      return durationToMinutes(hours, 0);
    }
  }

  const minuteMatch = normalized.match(/(\d+)\s*minutes?/i);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes)) {
      return minutes;
    }
  }

  const compactMatch = normalized.match(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?/i);
  if (compactMatch) {
    const hours = Number(compactMatch[1]);
    const minutes = Number(compactMatch[2]);

    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return durationToMinutes(hours, minutes);
    }
  }

  return null;
}

function parseDateCandidates(text: string): Date | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const now = REFERENCE_DATE;

  const isoDate = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]) - 1;
    const day = Number(isoDate[3]);
    const hours = isoDate[4] ? Number(isoDate[4]) : 0;
    const minutes = isoDate[5] ? Number(isoDate[5]) : 0;
    return new Date(year, month, day, hours, minutes);
  }

  const explicitDate = normalized.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (explicitDate) {
    const first = Number(explicitDate[1]);
    const second = Number(explicitDate[2]);
    const year = explicitDate[3] ? Number(explicitDate[3].length === 2 ? `20${explicitDate[3]}` : explicitDate[3]) : now.getFullYear();
    const candidateFirst = new Date(year, second - 1, first);
    const candidateSecond = new Date(year, first - 1, second);
    return isNaN(candidateFirst.getTime()) ? candidateSecond : candidateFirst;
  }

  if (/today|hoje/i.test(normalized)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  return null;
}

function toDisplayDuration(totalMinutes: number): string {
  const { hours, minutes } = minutesToDuration(totalMinutes);
  return `${hours}h ${minutes}m`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function aggregateSessions(sessions: RawSession[]): GamePlaytime[] {
  const totals = new Map<string, { title: string; minutes: number }>();

  for (const session of sessions) {
    const key = normalizeText(session.title);
    const current = totals.get(key);
    if (current) {
      current.minutes += session.minutes;
      if (session.title.length > current.title.length) {
        current.title = session.title;
      }
      continue;
    }

    totals.set(key, { title: session.title, minutes: session.minutes });
  }

  return Array.from(totals.values()).map((item) => {
    const { hours, minutes } = minutesToDuration(item.minutes);
    return { title: item.title, hours, minutes };
  });
}

async function loginIfNeeded(page: Page): Promise<void> {
  await page.goto(PLAYTIMES_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const sessionsTablePresent =
    (await page
      .locator('table')
      .filter({ has: page.locator('thead th', { hasText: /^Start$/i }) })
      .filter({ has: page.locator('thead th', { hasText: /^End$/i }) })
      .count()) > 0;
  if (sessionsTablePresent) {
    return;
  }

  const loginVisible = await page.getByText(/you need to login/i).isVisible().catch(() => false);
  const loginForm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /login/i }) })
    .first();
  const visibleInputs = loginForm.locator('input:visible:not([type="hidden"]):not([disabled])');
  const visibleInputCount = await visibleInputs.count();

  if (!loginVisible && visibleInputCount === 0) {
    return;
  }

  const code = process.env.PS_TIMETRACKER_CODE;
  if (!code) {
    throw new Error('PS_TIMETRACKER_CODE is required to access the playtimes page.');
  }

  await loginForm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);

  const inputs = visibleInputs;
  const inputCount = await inputs.count();

  if (inputCount === 0) {
    throw new Error('Could not find a visible PS-Timetracker login input.');
  }

  if (inputCount === 1) {
    await inputs.first().fill(code);
  } else if (inputCount >= 2) {
    await inputs.nth(0).fill(PSN_NAME);
    await inputs.nth(1).fill(code);
  } else {
    throw new Error('Could not find a visible PS-Timetracker login input.');
  }

  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // Login may redirect to profile root. Always return to sessions page.
  await page.goto(PLAYTIMES_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const stillBlocked = await page.getByText(/you need to login/i).isVisible().catch(() => false);
  if (stillBlocked) {
    throw new Error('PS-Timetracker login did not succeed. Verify PS_TIMETRACKER_CODE and account access.');
  }
}

async function scrapeTodaySessions(page: Page): Promise<GamePlaytime[]> {
  const todayDate = REFERENCE_DATE;
  const yesterdayCutoff = new Date(REFERENCE_DATE);
  yesterdayCutoff.setDate(yesterdayCutoff.getDate() - 1);
  const sessions: RawSession[] = [];

  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const pageUrl = pageNumber === 1 ? PLAYTIMES_URL : `${PLAYTIMES_URL}?page=${pageNumber}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Scope to the detailed sessions table, not the aggregated games table.
    const sessionsTable = page
      .locator('table')
      .filter({ has: page.locator('thead th', { hasText: /^Start$/i }) })
      .filter({ has: page.locator('thead th', { hasText: /^End$/i }) })
      .first();

    const rows = sessionsTable.locator('tbody tr');
    const rowCount = await rows.count();
    if (DEBUG_SYNC) {
      console.log(`Inspecting playtimes page ${pageNumber}: ${rowCount} row(s)`);
    }
    if (rowCount === 0) {
      break;
    }

    let sawRecentRow = false;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows.nth(rowIndex);
      const cells = row.locator('td');
      const cellCount = await cells.count();
      if (cellCount < 6) {
        continue;
      }

      const title = collapseSpaces(await cells.nth(1).innerText().catch(() => ''));
      const durationCell = cells.nth(3);
      const durationText = collapseSpaces(await durationCell.innerText().catch(() => ''));
      const durationSort = (await durationCell.getAttribute('data-sort').catch(() => null))?.trim() ?? '';
      const startText = collapseSpaces(await cells.nth(4).innerText().catch(() => ''));
      const startDate = parseDateCandidates(startText);
      const durationFromSort = /^\d+$/.test(durationSort) ? Math.round(Number(durationSort) / 60) : null;
      const duration = durationFromSort ?? parseDuration(durationText);

      if (DEBUG_SYNC) {
        const iso = startDate ? startDate.toISOString() : 'invalid-date';
        console.log(`Row ${rowIndex + 1}: title="${title}" durationText="${durationText}" durationSort="${durationSort}" start="${startText}" parsedStart=${iso} parsedMinutes=${duration ?? 'invalid'}`);
      }

      if (!title || !duration || !startDate) {
        continue;
      }

      if (startDate.getTime() < yesterdayCutoff.getTime() && startDate < todayDate) {
        continue;
      }

      sawRecentRow = true;
      sessions.push({ title, minutes: duration, startedAt: startDate });
    }

    if (!sawRecentRow) {
      break;
    }
  }

  return aggregateSessions(sessions);
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

    if (haystack === normalizedTitle || haystack.includes(normalizedTitle) || normalizedTitle.includes(haystack)) {
      return candidate;
    }

    const compactHaystack = haystack.replace(/[^a-z0-9]+/g, '');
    const compactTitle = normalizedTitle.replace(/[^a-z0-9]+/g, '');
    if (compactHaystack.includes(compactTitle) || compactTitle.includes(compactHaystack)) {
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
        .locator('#log-editor-full button[data-id="month-selector"] .filter-option-inner-inner')
        .first()
        .innerText()
        .catch(() => '')) ||
        (await page.locator('#log-editor-full button[data-id="month-selector"]').first().getAttribute('title').catch(() => '')) ||
        ''
    );
    const yearText = collapseSpaces(
      (await page
        .locator('#log-editor-full button[data-id="year-selector"] .filter-option-inner-inner')
        .first()
        .innerText()
        .catch(() => '')) ||
        (await page.locator('#log-editor-full button[data-id="year-selector"]').first().getAttribute('title').catch(() => '')) ||
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
  const calendar = page.locator('#log-editor-full #playthrough-calendar').first();
  if (await calendar.isVisible().catch(() => false)) {
    return;
  }

  const journalNav = page.locator('#journal-nav[editor_section="journal"], .journal-section-nav#journal-nav').first();
  if (await journalNav.count()) {
    await journalNav.click({ force: true });
    await page.waitForTimeout(300);
  }

  await calendar.waitFor({ state: 'visible', timeout: 20_000 });
}

async function waitForBackloggdMutation(page: Page, timeoutMs = 4_000): Promise<void> {
  await page.waitForResponse(
    (response) => {
      const request = response.request();
      const method = request.method().toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return false;
      }

      try {
        const parsed = new URL(response.url());
        if (!isBackloggdHost(parsed.hostname)) {
          return false;
        }

        const path = parsed.pathname.toLowerCase();
        const looksLikeLogMutation = /play|log|journal|entry|session/.test(path);
        if (!looksLikeLogMutation) {
          return false;
        }

        return response.status() >= 200 && response.status() < 400;
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs }
  );
}

async function confirmPlayDateSaved(page: Page, playDateModal: Locator): Promise<void> {
  const hiddenPromise = playDateModal.waitFor({ state: 'hidden', timeout: 4_000 });
  const mutationPromise = waitForBackloggdMutation(page, 4_000);

  await Promise.race([hiddenPromise, mutationPromise]);
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function confirmJournalSaved(page: Page): Promise<void> {
  const journalModal = page.locator('#journal-game-modal').first();
  const hiddenPromise = journalModal.waitFor({ state: 'hidden', timeout: 5_000 });
  const mutationPromise = waitForBackloggdMutation(page, 5_000);

  await Promise.race([hiddenPromise, mutationPromise]);
  await page.waitForLoadState('networkidle').catch(() => undefined);
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
  const dayCell = page.locator(`#log-editor-full #playthrough-calendar td.fc-day[data-date="${targetIsoDate}"]`).first();
  await dayCell.waitFor({ state: 'visible', timeout: 15_000 });
  await dayCell.click({ force: true });

  const playDateModal = page.locator('#playthrough-modal-content, #playthrough-modal .modal__content').first();
  let clickedSpecificDayEvent = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clickedDayEvent = await page
      .evaluate((isoDate) => {
        const dayTop = document.querySelector(`#log-editor-full #playthrough-calendar td.fc-day-top[data-date="${isoDate}"]`);
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
  await confirmJournalSaved(page);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: HEADLESS });
  const canReuseState = BACKLOGGD_STORAGE_STATE_PATH && (await fileExists(BACKLOGGD_STORAGE_STATE_PATH));
  const context: BrowserContext = await browser.newContext(
    canReuseState
      ? {
          storageState: BACKLOGGD_STORAGE_STATE_PATH
        }
      : undefined
  );
  const page = await context.newPage();

  try {
    console.log('Scraping PS-Timetracker playtimes...');
    await loginIfNeeded(page);
    const games = await scrapeTodaySessions(page);
    console.log(`Found ${games.length} aggregated game(s): ${games.map((game) => `${game.title} (${game.hours}h ${game.minutes}m)`).join(', ') || 'none'}`);

    if (games.length === 0) {
      console.log('No sessions found for today. Nothing to sync.');
      return;
    }

    console.log('Opening Backloggd playing page without initial login...');

    for (const game of games) {
      try {
        console.log(`Syncing ${game.title} -> ${toDisplayDuration(durationToMinutes(game.hours, game.minutes))}`);
        await page.goto(backloggdUrl('/u/henriquetavares/playing/'), { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await waitForBackloggdReady(page);
        updateBackloggdOriginFromUrl(page.url());
        await logPlaySession(page, game);

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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipping ${game.title}: ${message}`);
      }
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