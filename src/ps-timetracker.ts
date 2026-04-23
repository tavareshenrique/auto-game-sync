import type { Page } from 'playwright';
import { aggregateSessions, collapseSpaces, parseDateCandidates, parseDuration, type GamePlaytime, type RawSession } from './domain.js';

if (!process.env.PS_TIMETRACKER_PSN_NAME) {
  throw new Error('PS_TIMETRACKER_PSN_NAME environment variable is required.');
}

const PLAYTIMES_URL = `https://ps-timetracker.com/profile/${process.env.PS_TIMETRACKER_PSN_NAME}/playtimes`;
const PSN_NAME = process.env.PS_TIMETRACKER_PSN_NAME;

type PSTimetrackerOptions = {
  referenceDate: Date;
  debug?: boolean;
};

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

  await page.goto(PLAYTIMES_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const stillBlocked = await page.getByText(/you need to login/i).isVisible().catch(() => false);
  if (stillBlocked) {
    throw new Error('PS-Timetracker login did not succeed. Verify PS_TIMETRACKER_CODE and account access.');
  }
}

async function scrapeTodaySessions(page: Page, options: PSTimetrackerOptions): Promise<GamePlaytime[]> {
  const { referenceDate, debug = false } = options;
  const dayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const sessions: RawSession[] = [];

  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const pageUrl = pageNumber === 1 ? PLAYTIMES_URL : `${PLAYTIMES_URL}?page=${pageNumber}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const sessionsTable = page
      .locator('table')
      .filter({ has: page.locator('thead th', { hasText: /^Start$/i }) })
      .filter({ has: page.locator('thead th', { hasText: /^End$/i }) })
      .first();

    const rows = sessionsTable.locator('tbody tr');
    const rowCount = await rows.count();
    if (debug) {
      console.log(`Inspecting playtimes page ${pageNumber}: ${rowCount} row(s)`);
    }
    if (rowCount === 0) {
      break;
    }

    let sawRowOnOrAfterDayStart = false;

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
      const startDate = parseDateCandidates(startText, referenceDate);
      const durationFromSort = /^\d+$/.test(durationSort) ? Math.round(Number(durationSort) / 60) : null;
      const duration = durationFromSort ?? parseDuration(durationText);

      if (debug) {
        const iso = startDate ? startDate.toISOString() : 'invalid-date';
        console.log(`Row ${rowIndex + 1}: title="${title}" durationText="${durationText}" durationSort="${durationSort}" start="${startText}" parsedStart=${iso} parsedMinutes=${duration ?? 'invalid'}`);
      }

      if (!title || !duration || !startDate) {
        continue;
      }

      if (startDate >= dayEnd) {
        // Ignore rows after the target day.
        continue;
      }

      if (startDate < dayStart) {
        // Table is sorted by newest first; a full page older than dayStart means we can stop paginating.
        continue;
      }

      sawRowOnOrAfterDayStart = true;
      sessions.push({ title, minutes: duration, startedAt: startDate });
    }

    if (!sawRowOnOrAfterDayStart) {
      break;
    }
  }

  return aggregateSessions(sessions);
}

export { loginIfNeeded, scrapeTodaySessions };