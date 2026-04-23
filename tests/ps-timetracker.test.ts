import { test, expect } from '@playwright/test';
import { parseSessionRow, type RawRowCells } from '../src/ps-timetracker.js';

const REF = new Date(2024, 5, 15); // 2024-06-15

function cells(overrides: Partial<RawRowCells> = {}): RawRowCells {
  return {
    title: 'God of War',
    durationText: '1:30 hours',
    durationSort: '',
    startText: '2024-06-15T12:00:00',
    ...overrides,
  };
}

test.describe('parseSessionRow', () => {
  test('returns a session for a valid row', () => {
    const result = parseSessionRow(cells(), REF);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('God of War');
    expect(result!.minutes).toBe(90);
    expect(result!.startedAt).toBeInstanceOf(Date);
  });

  test('returns null when title is empty', () => {
    expect(parseSessionRow(cells({ title: '' }), REF)).toBeNull();
  });

  test('returns null when duration cannot be parsed and durationSort is absent', () => {
    expect(parseSessionRow(cells({ durationText: 'N/A', durationSort: '' }), REF)).toBeNull();
  });

  test('returns null when start date cannot be parsed', () => {
    expect(parseSessionRow(cells({ startText: '' }), REF)).toBeNull();
  });

  test('uses durationSort (seconds) when it is a pure integer', () => {
    // durationSort stores seconds; function converts to minutes via Math.round
    const result = parseSessionRow(
      cells({ durationSort: '3600', durationText: 'irrelevant' }),
      REF
    );
    expect(result).not.toBeNull();
    expect(result!.minutes).toBe(60);
  });

  test('rounds fractional seconds to nearest minute', () => {
    // 90 seconds → Math.round(90/60) = 2 minutes
    const result = parseSessionRow(cells({ durationSort: '90' }), REF);
    expect(result!.minutes).toBe(2);
  });

  test('falls back to durationText when durationSort is empty', () => {
    const result = parseSessionRow(cells({ durationSort: '', durationText: '45 minutes' }), REF);
    expect(result!.minutes).toBe(45);
  });

  test('falls back to durationText when durationSort is non-numeric', () => {
    const result = parseSessionRow(cells({ durationSort: 'abc', durationText: '2 hours' }), REF);
    expect(result!.minutes).toBe(120);
  });

  test('durationSort takes precedence over durationText', () => {
    // durationSort=7200s=120min, durationText says 30min — sort wins
    const result = parseSessionRow(
      cells({ durationSort: '7200', durationText: '30 minutes' }),
      REF
    );
    expect(result!.minutes).toBe(120);
  });

  test('preserves the title as-is', () => {
    const result = parseSessionRow(cells({ title: 'Elden Ring™' }), REF);
    expect(result!.title).toBe('Elden Ring™');
  });
});
