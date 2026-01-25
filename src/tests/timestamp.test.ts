import { describe, it, expect } from 'vitest';

// Timestamp regex patterns from main/index.ts
const ISO_TIMESTAMP_REGEX = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/;
const EURO_TIMESTAMP_REGEX = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const COMMON_TIMESTAMP_REGEX = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;

function parseTimestamp(line: string): Date | null {
  // Try ISO format first (most common in logs)
  let match = line.match(ISO_TIMESTAMP_REGEX);
  if (match) {
    const [, year, month, day, hour, minute, second, ms] = match;
    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10),
      ms ? parseInt(ms.padEnd(3, '0').slice(0, 3), 10) : 0
    );
    return date;
  }

  // Try European format (DD.MM.YYYY HH:mm:ss)
  match = line.match(EURO_TIMESTAMP_REGEX);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10)
    );
    return date;
  }

  // Try common US format (MM/DD/YYYY HH:mm:ss)
  match = line.match(COMMON_TIMESTAMP_REGEX);
  if (match) {
    const [, month, day, year, hour, minute, second] = match;
    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10)
    );
    return date;
  }

  return null;
}

describe('Timestamp Parsing', () => {
  describe('ISO Format', () => {
    it('should parse ISO timestamp with T separator', () => {
      const date = parseTimestamp('2024-01-15T14:30:45.123 INFO Starting application');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(0); // January
      expect(date!.getDate()).toBe(15);
      expect(date!.getHours()).toBe(14);
      expect(date!.getMinutes()).toBe(30);
      expect(date!.getSeconds()).toBe(45);
    });

    it('should parse ISO timestamp with space separator', () => {
      const date = parseTimestamp('2024-01-15 14:30:45 ERROR Connection failed');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getHours()).toBe(14);
    });

    it('should parse ISO timestamp without milliseconds', () => {
      const date = parseTimestamp('2024-12-31 23:59:59 DEBUG End of year');
      expect(date).not.toBeNull();
      expect(date!.getMonth()).toBe(11); // December
      expect(date!.getDate()).toBe(31);
    });
  });

  describe('European Format (DD.MM.YYYY)', () => {
    it('should parse European timestamp format', () => {
      const date = parseTimestamp('15.01.2024 14:30:45 INFO European log entry');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(0); // January
      expect(date!.getDate()).toBe(15);
      expect(date!.getHours()).toBe(14);
    });

    it('should parse European timestamp with leading zeros', () => {
      const date = parseTimestamp('01.02.2024 08:05:03 DEBUG Early morning');
      expect(date).not.toBeNull();
      expect(date!.getDate()).toBe(1);
      expect(date!.getMonth()).toBe(1); // February
      expect(date!.getHours()).toBe(8);
    });
  });

  describe('US Format (MM/DD/YYYY)', () => {
    it('should parse US timestamp format', () => {
      const date = parseTimestamp('01/15/2024 14:30:45 INFO US log entry');
      expect(date).not.toBeNull();
      expect(date!.getMonth()).toBe(0); // January
      expect(date!.getDate()).toBe(15);
    });
  });

  describe('Edge Cases', () => {
    it('should return null for lines without timestamps', () => {
      const date = parseTimestamp('Just some random log text without timestamp');
      expect(date).toBeNull();
    });

    it('should return null for invalid date formats', () => {
      const date = parseTimestamp('15-01-2024 14:30:45 Invalid format');
      expect(date).toBeNull();
    });

    it('should handle timestamp at end of line', () => {
      const date = parseTimestamp('Log entry at 2024-01-15T14:30:45');
      expect(date).not.toBeNull();
    });
  });
});
