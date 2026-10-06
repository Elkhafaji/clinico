import dayjs from 'dayjs';

/** Return ISO bounds for the selected calendar day in the server's clinic timezone. */
export function localDayRange(value) {
  const start = value == null ? dayjs().startOf('day') : dayjs(value).startOf('day');
  return [start.toISOString(), start.add(1, 'day').toISOString()];
}
