import { test, expect } from '@playwright/test';
import { shouldSendSyncEmail } from '../scripts/generate-email.js';

test.describe('shouldSendSyncEmail', () => {
  test('returns false when no games were synchronized', () => {
    expect(
      shouldSendSyncEmail({
        generatedAt: '2026-07-01T09:00:00.000Z',
        referenceDate: '2026-06-30',
        totalGames: 0,
        games: [],
      })
    ).toBe(false);
  });

  test('returns true when at least one game was synchronized', () => {
    expect(
      shouldSendSyncEmail({
        generatedAt: '2026-07-01T09:00:00.000Z',
        referenceDate: '2026-06-30',
        totalGames: 1,
        games: [
          {
            title: 'Hades II',
            playedTime: '1h 30m',
            registeredDay: '30/06/2026',
          },
        ],
      })
    ).toBe(true);
  });
});
