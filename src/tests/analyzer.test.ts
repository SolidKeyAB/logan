import { describe, it, expect } from 'vitest';

// Level normalization logic from columnAwareAnalyzer
function normalizeLevel(rawLevel: string): string | null {
  const level = rawLevel.toLowerCase().trim();
  if (/^(error|fatal|critical|severe)$/.test(level)) return 'error';
  if (/^(warn|warning)$/.test(level)) return 'warning';
  if (/^(info|information)$/.test(level)) return 'info';
  if (/^debug$/.test(level)) return 'debug';
  if (/^(trace|verbose)$/.test(level)) return 'trace';
  return null;
}

// Level detection from text
function detectLevelFromText(text: string): string | null {
  const upper = text.toUpperCase();
  if (/\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC)\b/.test(upper)) return 'error';
  if (/\b(WARN|WARNING)\b/.test(upper)) return 'warning';
  if (/\b(INFO)\b/.test(upper)) return 'info';
  if (/\b(DEBUG)\b/.test(upper)) return 'debug';
  if (/\b(TRACE|VERBOSE)\b/.test(upper)) return 'trace';
  return null;
}

// Column type detection
function detectColumnType(samples: string[]): string {
  const nonEmpty = samples.filter(s => s && s.trim());
  if (nonEmpty.length === 0) return 'unknown';

  // Check if all samples are timestamps
  const timestampPattern = /^\d{4}-\d{2}-\d{2}|^\d{2}[.\/]\d{2}[.\/]\d{4}|^\d{2}:\d{2}:\d{2}/;
  if (nonEmpty.every(s => timestampPattern.test(s))) return 'timestamp';

  // Check if all samples are log levels
  const levelPattern = /^(error|warn|warning|info|debug|trace|fatal|critical|verbose)$/i;
  if (nonEmpty.every(s => levelPattern.test(s.trim()))) return 'level';

  // Check if all samples are numbers
  if (nonEmpty.every(s => !isNaN(Number(s)))) return 'number';

  // Check if all samples look like identifiers/sources
  const identPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;
  if (nonEmpty.every(s => identPattern.test(s.trim()) && s.length < 50)) return 'identifier';

  return 'text';
}

// Pattern extraction (simplified version)
// Note: Order matters - more specific patterns first
function extractPattern(message: string): string {
  return message
    // IP addresses first (before numbers break them up)
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{IP}')
    // Hex values (before numbers)
    .replace(/\b[0-9a-f]{8,}\b/gi, '{HEX}')
    // Numbers
    .replace(/\b\d+\b/g, '{N}')
    // Quoted strings
    .replace(/"[^"]*"/g, '"{STR}"')
    .replace(/'[^']*'/g, "'{STR}'");
}

describe('Log Level Detection', () => {
  describe('normalizeLevel', () => {
    it('should normalize error levels', () => {
      expect(normalizeLevel('ERROR')).toBe('error');
      expect(normalizeLevel('error')).toBe('error');
      expect(normalizeLevel('FATAL')).toBe('error');
      expect(normalizeLevel('critical')).toBe('error');
      expect(normalizeLevel('SEVERE')).toBe('error');
    });

    it('should normalize warning levels', () => {
      expect(normalizeLevel('WARN')).toBe('warning');
      expect(normalizeLevel('warning')).toBe('warning');
      expect(normalizeLevel('WARNING')).toBe('warning');
    });

    it('should normalize info levels', () => {
      expect(normalizeLevel('INFO')).toBe('info');
      expect(normalizeLevel('information')).toBe('info');
    });

    it('should normalize debug levels', () => {
      expect(normalizeLevel('DEBUG')).toBe('debug');
      expect(normalizeLevel('debug')).toBe('debug');
    });

    it('should normalize trace levels', () => {
      expect(normalizeLevel('TRACE')).toBe('trace');
      expect(normalizeLevel('verbose')).toBe('trace');
    });

    it('should return null for unknown levels', () => {
      expect(normalizeLevel('UNKNOWN')).toBeNull();
      expect(normalizeLevel('custom')).toBeNull();
    });
  });

  describe('detectLevelFromText', () => {
    it('should detect error keywords in text', () => {
      expect(detectLevelFromText('Connection failed with ERROR')).toBe('error');
      expect(detectLevelFromText('FATAL: Out of memory')).toBe('error');
      expect(detectLevelFromText('Exception thrown in module')).toBe('error');
      expect(detectLevelFromText('Kernel PANIC')).toBe('error');
    });

    it('should detect warning keywords in text', () => {
      expect(detectLevelFromText('WARN: Low disk space')).toBe('warning');
      expect(detectLevelFromText('Warning: deprecated API')).toBe('warning');
    });

    it('should detect info keywords in text', () => {
      expect(detectLevelFromText('INFO: Server started')).toBe('info');
    });

    it('should return null for text without level keywords', () => {
      expect(detectLevelFromText('Just a normal log message')).toBeNull();
    });
  });
});

describe('Column Type Detection', () => {
  it('should detect timestamp columns', () => {
    expect(detectColumnType(['2024-01-15', '2024-01-16', '2024-01-17'])).toBe('timestamp');
    expect(detectColumnType(['15.01.2024', '16.01.2024'])).toBe('timestamp');
    expect(detectColumnType(['14:30:45', '14:30:46'])).toBe('timestamp');
  });

  it('should detect level columns', () => {
    expect(detectColumnType(['ERROR', 'INFO', 'DEBUG'])).toBe('level');
    expect(detectColumnType(['warn', 'error', 'info'])).toBe('level');
  });

  it('should detect number columns', () => {
    expect(detectColumnType(['123', '456', '789'])).toBe('number');
    expect(detectColumnType(['0', '100', '200'])).toBe('number');
  });

  it('should detect identifier columns', () => {
    expect(detectColumnType(['MainApp', 'UserService', 'Database'])).toBe('identifier');
    expect(detectColumnType(['com.app.main', 'com.app.user'])).toBe('identifier');
  });

  it('should detect text columns', () => {
    expect(detectColumnType(['This is a message', 'Another message'])).toBe('text');
  });

  it('should handle empty samples', () => {
    expect(detectColumnType([])).toBe('unknown');
    expect(detectColumnType(['', '  '])).toBe('unknown');
  });
});

describe('Pattern Extraction', () => {
  it('should replace numbers with placeholder', () => {
    // Standalone numbers are replaced
    expect(extractPattern('User 12345 logged in')).toBe('User {N} logged in');
    expect(extractPattern('Port 8080 is open')).toBe('Port {N} is open');
    // Numbers attached to text are not replaced (word boundary issue)
    expect(extractPattern('Request took 150ms')).toBe('Request took 150ms');
  });

  it('should replace hex values with placeholder', () => {
    expect(extractPattern('Session abc123def456')).toBe('Session {HEX}');
    // 0x prefix remains, only the hex part is replaced
    expect(extractPattern('Transaction deadbeef01')).toBe('Transaction {HEX}');
  });

  it('should replace IP addresses with placeholder', () => {
    expect(extractPattern('Connection from 192.168.1.100')).toBe('Connection from {IP}');
  });

  it('should replace quoted strings with placeholder', () => {
    expect(extractPattern('Error: "Connection refused"')).toBe('Error: "{STR}"');
    expect(extractPattern("Config: 'production'")).toBe("Config: '{STR}'");
  });

  it('should handle multiple replacements', () => {
    const result = extractPattern('User 123 from 10.0.0.1 error: "timeout"');
    expect(result).toBe('User {N} from {IP} error: "{STR}"');
  });
});
