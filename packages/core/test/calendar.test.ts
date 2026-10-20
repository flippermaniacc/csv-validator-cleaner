import { describe, expect, it } from 'vitest';
import { daysInMonth, isLeapYear, isValidCalendarDate, parseIsoDate } from '../src/index.js';

describe('calendar helpers', () => {
  it.each([
    [2000, true],
    [1900, false],
    [2024, true],
    [2023, false],
  ])('isLeapYear(%i) = %s', (year, expected) => {
    expect(isLeapYear(year)).toBe(expected);
  });

  it('knows month lengths', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });

  it('validates calendar dates', () => {
    expect(isValidCalendarDate(2024, 2, 29)).toBe(true);
    expect(isValidCalendarDate(2023, 2, 29)).toBe(false);
    expect(isValidCalendarDate(2024, 4, 31)).toBe(false);
    expect(isValidCalendarDate(2024, 13, 1)).toBe(false);
    expect(isValidCalendarDate(2024, 0, 1)).toBe(false);
    expect(isValidCalendarDate(2024, 1, 0)).toBe(false);
    expect(isValidCalendarDate(2024, 1.5, 1)).toBe(false);
  });

  it('parses strict YYYY-MM-DD only', () => {
    expect(parseIsoDate('2024-03-01')).toEqual({ year: 2024, month: 3, day: 1 });
    for (const bad of ['2024-3-1', '2024-02-30', '01.03.2024', ' 2024-03-01', '2024-03-01 ', '']) {
      expect(parseIsoDate(bad)).toBeNull();
    }
  });
});
