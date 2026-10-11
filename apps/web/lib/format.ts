/** Default display timezone (MASTER_SPEC.md). Values are stored in UTC. */
export const DISPLAY_TIMEZONE = 'America/New_York';
export const DISPLAY_TIMEZONE_LABEL = 'ET';

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTime(iso: string): string {
  return `${timeFormat.format(new Date(iso))} ${DISPLAY_TIMEZONE_LABEL}`;
}

export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} ${DISPLAY_TIMEZONE_LABEL}`;
}

export function formatAge(ms: number): string {
  if (ms < 1_000) return 'under 1 s';
  const s = Math.round(ms / 1_000);
  if (s < 120) return `${s} s`;
  return `${Math.round(s / 60)} min`;
}
