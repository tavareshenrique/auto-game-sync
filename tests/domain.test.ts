import { test, expect } from '@playwright/test';
import {
  aggregateSessions,
  collapseSpaces,
  durationToMinutes,
  getReferenceDate,
  minutesToDuration,
  normalizeText,
  parseDateCandidates,
  parseDuration,
  toDisplayDuration,
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
