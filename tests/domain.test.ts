import { test, expect } from '@playwright/test';
import {
  aggregateSessions,
  collapseSpaces,
  describeCatalogCandidates,
  durationToMinutes,
  getMonthIndex,
  getMonthName,
  getReferenceDate,
  isStandardEditionLabel,
  minutesToDuration,
  normalizeText,
  parseDateCandidates,
  parseDuration,
  pickPreferredPlatformLabel,
  pickStandardEditionLabel,
  selectCatalogCandidate,
  toDisplayDuration,
  toLocalIsoDate,
} from '../src/domain.js';

// --- normalizeText ---

test.describe('normalizeText', () => {
  test('lowercases and removes accents', () => {
    expect(normalizeText('Ação')).toBe('acao');
    expect(normalizeText('Élan')).toBe('elan');
  });

  test('replaces non-alphanumeric sequences with a single space', () => {
    expect(normalizeText('God of War: Ragnarök')).toBe('god of war ragnarok');
  });

  test('trims leading and trailing spaces', () => {
    expect(normalizeText('  hello world  ')).toBe('hello world');
  });

  test('collapses internal punctuation runs to a single space', () => {
    expect(normalizeText('A--B  C')).toBe('a b c');
  });
});

// --- collapseSpaces ---

test.describe('collapseSpaces', () => {
  test('collapses multiple spaces to one', () => {
    expect(collapseSpaces('a  b   c')).toBe('a b c');
  });

  test('trims edges', () => {
    expect(collapseSpaces('  hello  ')).toBe('hello');
  });

  test('handles tabs and newlines', () => {
    expect(collapseSpaces('a\t\nb')).toBe('a b');
  });
});

// --- durationToMinutes ---

test.describe('durationToMinutes', () => {
  test('converts hours and minutes correctly', () => {
    expect(durationToMinutes(1, 30)).toBe(90);
    expect(durationToMinutes(2, 0)).toBe(120);
    expect(durationToMinutes(0, 45)).toBe(45);
  });

  test('handles zero duration', () => {
    expect(durationToMinutes(0, 0)).toBe(0);
  });
});

// --- minutesToDuration ---

test.describe('minutesToDuration', () => {
  test('splits total minutes into hours and remainder minutes', () => {
    expect(minutesToDuration(90)).toEqual({ hours: 1, minutes: 30 });
    expect(minutesToDuration(65)).toEqual({ hours: 1, minutes: 5 });
    expect(minutesToDuration(45)).toEqual({ hours: 0, minutes: 45 });
  });

  test('handles exact hours', () => {
    expect(minutesToDuration(120)).toEqual({ hours: 2, minutes: 0 });
  });

  test('handles zero', () => {
    expect(minutesToDuration(0)).toEqual({ hours: 0, minutes: 0 });
  });
});

// --- parseDuration ---

test.describe('parseDuration', () => {
  test('parses HH:MM hours format', () => {
    expect(parseDuration('1:30 hours')).toBe(90);
    expect(parseDuration('2:05 hours')).toBe(125);
  });

  test('parses whole-hour format', () => {
    expect(parseDuration('2 hours')).toBe(120);
    expect(parseDuration('1 hour')).toBe(60);
  });

  test('parses minutes-only format', () => {
    expect(parseDuration('45 minutes')).toBe(45);
    expect(parseDuration('1 minute')).toBe(1);
  });

  test('parses compact h/m format', () => {
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('2h30min')).toBe(150);
    expect(parseDuration('0h 10min')).toBe(10);
  });

  test('returns null for unrecognized text', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('invalid')).toBeNull();
    expect(parseDuration('just some text here')).toBeNull();
  });

  test('is case-insensitive', () => {
    expect(parseDuration('2 HOURS')).toBe(120);
    expect(parseDuration('30 Minutes')).toBe(30);
  });

  test('tolerates extra whitespace', () => {
    expect(parseDuration('  1:30  hours  ')).toBe(90);
  });
});

// --- parseDateCandidates ---

const REF = new Date(2024, 0, 15); // 2024-01-15

test.describe('parseDateCandidates', () => {
  test('parses ISO date string', () => {
    const result = parseDateCandidates('2024-03-20', REF);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(2);
    expect(result!.getDate()).toBe(20);
  });

  test('parses ISO datetime string', () => {
    const result = parseDateCandidates('2024-03-20 10:30', REF);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(10);
    expect(result!.getMinutes()).toBe(30);
  });

  test('parses ISO datetime with T separator', () => {
    const result = parseDateCandidates('2024-03-20T14:00', REF);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(14);
  });

  test('parses explicit date with slash', () => {
    const result = parseDateCandidates('20/03/2024', REF);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(2);
    expect(result!.getDate()).toBe(20);
  });

  test('parses explicit date without year, uses reference year', () => {
    const result = parseDateCandidates('20/03', REF);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(REF.getFullYear());
  });

  test('returns today for "today"', () => {
    const result = parseDateCandidates('today', REF);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(REF.getFullYear());
    expect(result!.getMonth()).toBe(REF.getMonth());
    expect(result!.getDate()).toBe(REF.getDate());
  });

  test('returns today for "hoje"', () => {
    const result = parseDateCandidates('hoje', REF);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(REF.getDate());
  });

  test('returns null for unrecognized text', () => {
    expect(parseDateCandidates('', REF)).toBeNull();
    expect(parseDateCandidates('no date here', REF)).toBeNull();
  });
});

// --- toDisplayDuration ---

test.describe('toDisplayDuration', () => {
  test('formats correctly', () => {
    expect(toDisplayDuration(90)).toBe('1h 30m');
    expect(toDisplayDuration(0)).toBe('0h 0m');
    expect(toDisplayDuration(60)).toBe('1h 0m');
    expect(toDisplayDuration(5)).toBe('0h 5m');
  });
});

// --- aggregateSessions ---

test.describe('aggregateSessions', () => {
  test('returns empty array for no sessions', () => {
    expect(aggregateSessions([])).toEqual([]);
  });

  test('aggregates sessions with the same normalized title', () => {
    const sessions = [
      { title: 'God of War', minutes: 60 },
      { title: 'God of War', minutes: 45 },
    ];
    const result = aggregateSessions(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].hours).toBe(1);
    expect(result[0].minutes).toBe(45);
  });

  test('normalizes accents when grouping', () => {
    const sessions = [
      { title: 'Açao RPG', minutes: 30 },
      { title: 'Acao RPG', minutes: 30 },
    ];
    const result = aggregateSessions(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].minutes).toBe(0);
    expect(result[0].hours).toBe(1);
  });

  test('keeps longer title as canonical', () => {
    // Both normalize to 'god of war'; the one with more raw characters wins.
    const sessions = [
      { title: 'God of War', minutes: 30 },
      { title: 'God of War™', minutes: 30 },
    ];
    const result = aggregateSessions(sessions);
    expect(result[0].title).toBe('God of War™');
  });

  test('preserves distinct games separately', () => {
    const sessions = [
      { title: 'Game A', minutes: 20 },
      { title: 'Game B', minutes: 40 },
    ];
    const result = aggregateSessions(sessions);
    expect(result).toHaveLength(2);
  });

  test('converts total minutes to hours+minutes', () => {
    const sessions = [{ title: 'Some Game', minutes: 130 }];
    const result = aggregateSessions(sessions);
    expect(result[0].hours).toBe(2);
    expect(result[0].minutes).toBe(10);
  });
});

// --- toLocalIsoDate ---

test.describe('toLocalIsoDate', () => {
  test('formats local date components as YYYY-MM-DD', () => {
    expect(toLocalIsoDate(new Date(2026, 5, 21))).toBe('2026-06-21');
    expect(toLocalIsoDate(new Date(2024, 0, 5))).toBe('2024-01-05');
  });

  test('pads month and day with leading zeros', () => {
    expect(toLocalIsoDate(new Date(2024, 2, 3))).toBe('2024-03-03');
  });

  test('uses local calendar date components, not UTC slice', () => {
    const localMidnight = new Date(2026, 5, 21);
    expect(toLocalIsoDate(localMidnight)).toBe('2026-06-21');
    expect(toLocalIsoDate(localMidnight)).toBe(
      `${localMidnight.getFullYear()}-${String(localMidnight.getMonth() + 1).padStart(2, '0')}-${String(localMidnight.getDate()).padStart(2, '0')}`
    );
  });

  test('matches getReferenceDate local midnight', () => {
    delete process.env.SYNC_REFERENCE_DAYS_OFFSET;
    process.env.SYNC_REFERENCE_DATE = '2026-06-21T12:00:00';
    const ref = getReferenceDate();
    expect(toLocalIsoDate(ref)).toBe('2026-06-21');
    delete process.env.SYNC_REFERENCE_DATE;
  });
});

// --- getMonthIndex ---

test.describe('getMonthIndex', () => {
  test('resolves English month names', () => {
    expect(getMonthIndex('January')).toBe(0);
    expect(getMonthIndex('March')).toBe(2);
    expect(getMonthIndex('June')).toBe(5);
    expect(getMonthIndex('December')).toBe(11);
  });

  test('is case-insensitive', () => {
    expect(getMonthIndex('march')).toBe(2);
    expect(getMonthIndex('JUNE')).toBe(5);
  });

  test('returns -1 for unknown month names', () => {
    expect(getMonthIndex('')).toBe(-1);
    expect(getMonthIndex('Foo')).toBe(-1);
  });
});

// --- getMonthName ---

test.describe('getMonthName', () => {
  test('returns English month names by index', () => {
    expect(getMonthName(2)).toBe('March');
    expect(getMonthName(5)).toBe('June');
    expect(getMonthName(11)).toBe('December');
  });
});

// --- getReferenceDate ---

test.describe('getReferenceDate', () => {
  const original = {
    SYNC_REFERENCE_DATE: process.env.SYNC_REFERENCE_DATE,
    SYNC_REFERENCE_DAYS_OFFSET: process.env.SYNC_REFERENCE_DAYS_OFFSET,
  };

  test.afterEach(() => {
    if (original.SYNC_REFERENCE_DATE === undefined) {
      delete process.env.SYNC_REFERENCE_DATE;
    } else {
      process.env.SYNC_REFERENCE_DATE = original.SYNC_REFERENCE_DATE;
    }
    if (original.SYNC_REFERENCE_DAYS_OFFSET === undefined) {
      delete process.env.SYNC_REFERENCE_DAYS_OFFSET;
    } else {
      process.env.SYNC_REFERENCE_DAYS_OFFSET = original.SYNC_REFERENCE_DAYS_OFFSET;
    }
  });

  test('returns today at midnight when no env vars set', () => {
    delete process.env.SYNC_REFERENCE_DATE;
    delete process.env.SYNC_REFERENCE_DAYS_OFFSET;
    const result = getReferenceDate();
    const now = new Date();
    expect(result.getFullYear()).toBe(now.getFullYear());
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  test('returns date from SYNC_REFERENCE_DATE', () => {
    delete process.env.SYNC_REFERENCE_DAYS_OFFSET;
    // Use local-time format to avoid UTC-to-local conversion shifting the day.
    process.env.SYNC_REFERENCE_DATE = '2024-06-15T12:00:00';
    const result = getReferenceDate();
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(0);
  });

  test('throws on invalid SYNC_REFERENCE_DATE', () => {
    delete process.env.SYNC_REFERENCE_DAYS_OFFSET;
    process.env.SYNC_REFERENCE_DATE = 'not-a-date';
    expect(() => getReferenceDate()).toThrow('Invalid SYNC_REFERENCE_DATE');
  });

  test('returns offset date from SYNC_REFERENCE_DAYS_OFFSET', () => {
    delete process.env.SYNC_REFERENCE_DATE;
    process.env.SYNC_REFERENCE_DAYS_OFFSET = '-1';
    const result = getReferenceDate();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(result.getDate()).toBe(yesterday.getDate());
  });

  test('throws on invalid SYNC_REFERENCE_DAYS_OFFSET', () => {
    delete process.env.SYNC_REFERENCE_DATE;
    process.env.SYNC_REFERENCE_DAYS_OFFSET = 'abc';
    expect(() => getReferenceDate()).toThrow('Invalid SYNC_REFERENCE_DAYS_OFFSET');
  });
});

// --- selectCatalogCandidate ---

test.describe('selectCatalogCandidate', () => {
  test('keeps an exact title and ignores longer titles', () => {
    const selection = selectCatalogCandidate('God of War', [
      { title: 'God of War Ragnarök', slug: 'god-of-war-ragnarok', year: 2022 },
      { title: 'God of War', slug: 'god-of-war', year: 2018 },
      { title: 'God of War Remastered', slug: 'god-of-war-remastered', year: 2005 },
    ]);

    expect(selection).toEqual({
      status: 'selected',
      candidate: { title: 'God of War', slug: 'god-of-war', year: 2018 },
    });
  });

  test('matches titles ignoring accents and punctuation', () => {
    const selection = selectCatalogCandidate('God of War: Ragnarök', [
      { title: 'God of War Ragnarok', slug: 'god-of-war-ragnarok', year: 2022 },
    ]);

    expect(selection.status).toBe('selected');
  });

  test('keeps only Main Game when the search reports a category', () => {
    const selection = selectCatalogCandidate('God of War', [
      {
        title: 'God of War',
        slug: 'god-of-war-dlc',
        year: 2018,
        category: 'DLC',
        platforms: ['PlayStation 5'],
      },
      {
        title: 'God of War',
        slug: 'god-of-war',
        year: 2018,
        category: 'Main Game',
        platforms: ['PlayStation 4'],
      },
    ]);

    expect(selection).toEqual({
      status: 'selected',
      candidate: {
        title: 'God of War',
        slug: 'god-of-war',
        year: 2018,
        category: 'Main Game',
        platforms: ['PlayStation 4'],
      },
    });
  });

  test('prefers PlayStation 5, then 4, then 3', () => {
    const candidates = [
      {
        title: 'God of War',
        slug: 'ps3',
        year: 2005,
        category: 'Main Game',
        platforms: ['PS3'],
      },
      {
        title: 'God of War',
        slug: 'ps4',
        year: 2018,
        category: 'Main Game',
        platforms: ['PlayStation 4', 'Windows PC'],
      },
      {
        title: 'God of War',
        slug: 'ps5',
        year: 2022,
        category: 'Main Game',
        platforms: ['PlayStation 5'],
      },
    ];

    expect(selectCatalogCandidate('God of War', candidates)).toMatchObject({
      status: 'selected',
      candidate: { slug: 'ps5' },
    });

    expect(selectCatalogCandidate('God of War', candidates.slice(0, 2))).toMatchObject({
      status: 'selected',
      candidate: { slug: 'ps4' },
    });

    expect(selectCatalogCandidate('God of War', candidates.slice(0, 1))).toMatchObject({
      status: 'selected',
      candidate: { slug: 'ps3' },
    });
  });

  test('prefers the PlayStation 5 main game over a same-title remaster', () => {
    const selection = selectCatalogCandidate('God of War', [
      {
        title: 'God of War',
        slug: 'god-of-war--1',
        year: 2018,
        category: 'Main Game',
        platforms: ['Windows PC', 'PlayStation 5', 'PlayStation 4'],
      },
      {
        title: 'God of War',
        slug: 'god-of-war',
        year: 2005,
        category: 'Main Game',
        platforms: ['PlayStation 2'],
      },
      {
        title: 'God of War',
        slug: 'god-of-war--2',
        year: 2009,
        category: 'Remaster',
        platforms: ['PlayStation Vita', 'PlayStation 3'],
      },
      {
        title: 'God of War Ragnarök',
        slug: 'god-of-war-ragnarok',
        year: 2022,
        category: 'Main Game',
        platforms: ['PlayStation 5'],
      },
    ]);

    expect(selection).toMatchObject({
      status: 'selected',
      candidate: { slug: 'god-of-war--1', year: 2018 },
    });
  });

  test('fails a tie when two games share the best platform', () => {
    const selection = selectCatalogCandidate('God of War', [
      {
        title: 'God of War',
        slug: 'god-of-war',
        year: 2005,
        category: 'Main Game',
        platforms: ['PlayStation 4', 'PlayStation 3'],
      },
      {
        title: 'God of War',
        slug: 'god-of-war-2018',
        year: 2018,
        category: 'Main Game',
        platforms: ['PS4'],
      },
      {
        title: 'God of War',
        slug: 'god-of-war-ps3',
        year: 2012,
        category: 'Main Game',
        platforms: ['PlayStation 3'],
      },
    ]);

    expect(selection).toEqual({
      status: 'tie',
      candidates: [
        {
          title: 'God of War',
          slug: 'god-of-war',
          year: 2005,
          category: 'Main Game',
          platforms: ['PlayStation 4', 'PlayStation 3'],
        },
        {
          title: 'God of War',
          slug: 'god-of-war-2018',
          year: 2018,
          category: 'Main Game',
          platforms: ['PS4'],
        },
      ],
    });
  });

  test('returns no match when nothing has the exact title', () => {
    const selection = selectCatalogCandidate('God of War', [
      { title: 'God of War Ragnarök', slug: 'god-of-war-ragnarok', year: 2022 },
    ]);

    expect(selection.status).toBe('none');
    if (selection.status === 'none') {
      expect(selection.candidates.map((candidate) => candidate.slug)).toEqual([
        'god-of-war-ragnarok',
      ]);
    }
  });

  test('selects the only exact hit when platform is unknown', () => {
    const selection = selectCatalogCandidate('Hades', [
      { title: 'Hades', slug: 'hades', year: 2020 },
      { title: 'Hades II', slug: 'hades-ii', year: 2024 },
    ]);

    expect(selection).toEqual({
      status: 'selected',
      candidate: { title: 'Hades', slug: 'hades', year: 2020 },
    });
  });
});

test.describe('describeCatalogCandidates', () => {
  test('lists title, year, and slug', () => {
    expect(
      describeCatalogCandidates([
        { title: 'God of War', year: 2005, slug: 'god-of-war' },
        { title: 'God of War', year: null, slug: 'god-of-war-2018' },
      ])
    ).toBe('God of War (2005) [god-of-war]; God of War (unknown year) [god-of-war-2018]');
  });

  test('says none when the list is empty', () => {
    expect(describeCatalogCandidates([])).toBe('none');
  });
});

test.describe('edition and platform labels', () => {
  test('recognizes the standard edition labels', () => {
    expect(isStandardEditionLabel('Standard')).toBe(true);
    expect(isStandardEditionLabel('Standard Edition')).toBe(true);
    expect(isStandardEditionLabel('Edição Padrão')).toBe(true);
    expect(isStandardEditionLabel('Deluxe Edition')).toBe(false);
  });

  test('picks the standard edition option text', () => {
    expect(pickStandardEditionLabel(['Deluxe Edition', 'Edição Padrão', 'GOTY'])).toBe(
      'Edição Padrão'
    );
    expect(pickStandardEditionLabel(['Deluxe Edition'])).toBeNull();
  });

  test('picks the first PlayStation platform in PS5, PS4, PS3 order', () => {
    expect(
      pickPreferredPlatformLabel(['Windows PC', 'PlayStation 4', 'PlayStation 3', 'PlayStation 5'])
    ).toBe('PlayStation 5');
    expect(pickPreferredPlatformLabel(['Xbox One', 'PS4', 'PS3'])).toBe('PS4');
    expect(pickPreferredPlatformLabel(['Windows PC', 'Nintendo Switch'])).toBeNull();
  });
});
