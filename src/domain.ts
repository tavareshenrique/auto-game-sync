type GamePlaytime = {
  title: string;
  hours: number;
  minutes: number;
  coverUrl?: string;
};

type RawSession = {
  title: string;
  minutes: number;
  startedAt?: Date;
};

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

function durationToMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

function minutesToDuration(totalMinutes: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
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

function parseDateCandidates(text: string, referenceDate: Date): Date | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const now = referenceDate;

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
    const year = explicitDate[3]
      ? Number(explicitDate[3].length === 2 ? `20${explicitDate[3]}` : explicitDate[3])
      : now.getFullYear();
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

function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    'december',
  ];

  return names.indexOf(monthName.toLowerCase());
}

function getMonthName(monthIndex: number): string {
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return names[monthIndex] ?? '';
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

export type { GamePlaytime, RawSession };
export {
  aggregateSessions,
  collapseSpaces,
  durationToMinutes,
  getMonthIndex,
  getMonthName,
  getReferenceDate,
  minutesToDuration,
  normalizeText,
  parseDateCandidates,
  parseDuration,
  toDisplayDuration,
  toLocalIsoDate,
};
