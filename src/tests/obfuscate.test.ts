import { describe, it, expect, beforeEach } from 'vitest';

// === Inline copy of Obfuscator core logic for testing (no fs/os deps) ===

const BUILTIN_PATTERNS: Array<{ name: string; regex: RegExp; prefix: string }> = [
  { name: 'ipv4', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, prefix: 'IP' },
  { name: 'ipv6', regex: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, prefix: 'IPV6' },
  { name: 'ipv6_short', regex: /\b(?:[0-9a-fA-F]{1,4}:){2,6}(?::[0-9a-fA-F]{1,4}){1,5}\b/g, prefix: 'IPV6' },
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, prefix: 'EMAIL' },
  { name: 'uuid', regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, prefix: 'UUID' },
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, prefix: 'TOKEN' },
  { name: 'hex_key', regex: /\b[0-9a-fA-F]{32,}\b/g, prefix: 'KEY' },
];

interface CustomRule {
  name: string;
  pattern: string;
  replacement: string;
}

class Obfuscator {
  private sessionMaps: Map<string, Map<string, string>> = new Map();
  public customRules: CustomRule[] = [];

  reset(): void {
    this.sessionMaps.clear();
  }

  private getOrCreateMapping(prefix: string, originalValue: string): string {
    let map = this.sessionMaps.get(prefix);
    if (!map) {
      map = new Map();
      this.sessionMaps.set(prefix, map);
    }
    let placeholder = map.get(originalValue);
    if (!placeholder) {
      const index = map.size + 1;
      placeholder = `[${prefix}-${index}]`;
      map.set(originalValue, placeholder);
    }
    return placeholder;
  }

  obfuscate(text: string): string {
    let result = text;
    for (const { regex, prefix } of BUILTIN_PATTERNS) {
      regex.lastIndex = 0;
      result = result.replace(regex, (match) => this.getOrCreateMapping(prefix, match));
    }
    for (const rule of this.customRules) {
      try {
        const isNumbered = rule.replacement.includes('-N]');
        const regex = new RegExp(rule.pattern, 'g');
        if (isNumbered) {
          const baseReplacement = rule.replacement.replace('-N]', '');
          const prefix = baseReplacement.replace(/^\[/, '');
          result = result.replace(regex, (match) => this.getOrCreateMapping(prefix, match));
        } else {
          result = result.replace(regex, rule.replacement);
        }
      } catch {
        // Skip invalid regex
      }
    }
    return result;
  }

  obfuscateLines(lines: Array<{ text?: string; lineText?: string; [key: string]: any }>): void {
    for (const line of lines) {
      if (line.text) line.text = this.obfuscate(line.text);
      if (line.lineText) line.lineText = this.obfuscate(line.lineText);
    }
  }

  obfuscateObject<T>(obj: T): T {
    if (typeof obj === 'string') {
      return this.obfuscate(obj) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.obfuscateObject(item)) as unknown as T;
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.obfuscateObject(value);
      }
      return result;
    }
    return obj;
  }
}

// === Tests ===

describe('Obfuscator', () => {
  let ob: Obfuscator;

  beforeEach(() => {
    ob = new Obfuscator();
  });

  describe('IPv4 redaction', () => {
    it('should redact a single IPv4 address', () => {
      const result = ob.obfuscate('Connection from 192.168.1.100 accepted');
      expect(result).toBe('Connection from [IP-1] accepted');
      expect(result).not.toContain('192.168.1.100');
    });

    it('should redact multiple different IPs with different placeholders', () => {
      const result = ob.obfuscate('10.0.0.1 -> 172.16.0.5');
      expect(result).toBe('[IP-1] -> [IP-2]');
    });

    it('should use the same placeholder for the same IP across calls', () => {
      const r1 = ob.obfuscate('src=10.0.0.1');
      const r2 = ob.obfuscate('dst=10.0.0.1');
      expect(r1).toBe('src=[IP-1]');
      expect(r2).toBe('dst=[IP-1]');
    });

    it('should handle loopback and broadcast addresses', () => {
      const result = ob.obfuscate('localhost=127.0.0.1 broadcast=255.255.255.255');
      expect(result).toContain('[IP-1]');
      expect(result).toContain('[IP-2]');
      expect(result).not.toContain('127.0.0.1');
    });
  });

  describe('IPv6 redaction', () => {
    it('should redact full IPv6 addresses', () => {
      const result = ob.obfuscate('host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 connected');
      expect(result).toBe('host [IPV6-1] connected');
    });
  });

  describe('Email redaction', () => {
    it('should redact email addresses', () => {
      const result = ob.obfuscate('User alice@example.com logged in');
      expect(result).toBe('User [EMAIL-1] logged in');
    });

    it('should handle multiple emails', () => {
      const result = ob.obfuscate('from: a@b.com to: c@d.org');
      expect(result).toContain('[EMAIL-1]');
      expect(result).toContain('[EMAIL-2]');
    });

    it('should handle emails with dots and plus signs', () => {
      const result = ob.obfuscate('user.name+tag@company.co.uk sent mail');
      expect(result).toContain('[EMAIL-1]');
      expect(result).not.toContain('user.name');
    });
  });

  describe('UUID redaction', () => {
    it('should redact UUIDs', () => {
      const result = ob.obfuscate('request_id=550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBe('request_id=[UUID-1]');
    });

    it('should redact uppercase UUIDs', () => {
      const result = ob.obfuscate('ID: 550E8400-E29B-41D4-A716-446655440000');
      expect(result).toBe('ID: [UUID-1]');
    });

    it('should consistently map the same UUID', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      const r1 = ob.obfuscate(`first ${uuid}`);
      const r2 = ob.obfuscate(`second ${uuid}`);
      expect(r1).toBe('first [UUID-1]');
      expect(r2).toBe('second [UUID-1]');
    });
  });

  describe('JWT redaction', () => {
    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = ob.obfuscate(`Bearer ${jwt}`);
      expect(result).toBe('Bearer [TOKEN-1]');
      expect(result).not.toContain('eyJ');
    });
  });

  describe('Hex key redaction', () => {
    it('should redact 32+ character hex strings', () => {
      const key = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
      const result = ob.obfuscate(`api_key=${key}`);
      expect(result).toBe('api_key=[KEY-1]');
    });

    it('should not redact short hex strings', () => {
      const result = ob.obfuscate('color=#ff00ff');
      // 6 hex chars — should NOT be redacted
      expect(result).toBe('color=#ff00ff');
    });

    it('should redact 64-char hex keys (SHA-256)', () => {
      const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = ob.obfuscate(`hash=${sha}`);
      expect(result).toBe('hash=[KEY-1]');
    });
  });

  describe('Mixed sensitive data', () => {
    it('should redact multiple types in a single line', () => {
      const line = '2024-01-15 10:30:00 User alice@corp.com from 10.0.0.42 request=550e8400-e29b-41d4-a716-446655440000';
      const result = ob.obfuscate(line);
      expect(result).toContain('[EMAIL-1]');
      expect(result).toContain('[IP-1]');
      expect(result).toContain('[UUID-1]');
      expect(result).not.toContain('alice@corp.com');
      expect(result).not.toContain('10.0.0.42');
    });

    it('should preserve non-sensitive text', () => {
      const result = ob.obfuscate('ERROR: Connection timeout after 30s');
      expect(result).toBe('ERROR: Connection timeout after 30s');
    });
  });

  describe('Session consistency', () => {
    it('should give the same IP the same placeholder within a session', () => {
      ob.obfuscate('first 10.0.0.1');
      ob.obfuscate('second 10.0.0.2');
      const r3 = ob.obfuscate('third 10.0.0.1');
      expect(r3).toBe('third [IP-1]');
    });

    it('should reset mappings when reset() is called', () => {
      ob.obfuscate('10.0.0.1');
      ob.reset();
      const result = ob.obfuscate('10.0.0.1');
      // After reset, same IP gets [IP-1] again (counter resets)
      expect(result).toBe('[IP-1]');
    });

    it('should produce different mappings for different values after reset', () => {
      const r1 = ob.obfuscate('10.0.0.1 and 10.0.0.2');
      expect(r1).toBe('[IP-1] and [IP-2]');
      ob.reset();
      // After reset, 10.0.0.2 comes first → gets [IP-1]
      const r2 = ob.obfuscate('10.0.0.2 and 10.0.0.1');
      expect(r2).toBe('[IP-1] and [IP-2]');
    });
  });

  describe('obfuscateLines', () => {
    it('should redact text field in line objects', () => {
      const lines = [
        { lineNumber: 0, text: 'Connection from 10.0.0.1' },
        { lineNumber: 1, text: 'User alice@test.com logged in' },
      ];
      ob.obfuscateLines(lines);
      expect(lines[0].text).toBe('Connection from [IP-1]');
      expect(lines[1].text).toBe('User [EMAIL-1] logged in');
    });

    it('should redact lineText field in search match objects', () => {
      const matches = [
        { lineNumber: 5, lineText: 'Error at 192.168.0.1:8080' },
      ];
      ob.obfuscateLines(matches);
      expect(matches[0].lineText).toContain('[IP-1]');
      expect(matches[0].lineText).not.toContain('192.168.0.1');
    });

    it('should handle objects with neither text nor lineText', () => {
      const items = [{ lineNumber: 0, other: 'data' }];
      ob.obfuscateLines(items);
      expect(items[0].other).toBe('data');
    });
  });

  describe('obfuscateObject', () => {
    it('should deep-redact strings in nested objects', () => {
      const obj = {
        success: true,
        data: {
          matches: [
            { line: 'user admin@server.com connected', count: 5 },
          ],
          summary: 'Requests from 10.0.0.1',
        },
      };
      const result = ob.obfuscateObject(obj);
      expect(result.data.matches[0].line).toContain('[EMAIL-1]');
      expect(result.data.summary).toContain('[IP-1]');
      expect(result.success).toBe(true);
      expect(result.data.matches[0].count).toBe(5);
    });

    it('should handle null and undefined values', () => {
      const obj = { a: null, b: undefined, c: 'test 10.0.0.1' };
      const result = ob.obfuscateObject(obj);
      expect(result.a).toBeNull();
      expect(result.b).toBeUndefined();
      expect(result.c).toBe('test [IP-1]');
    });

    it('should handle primitive types', () => {
      expect(ob.obfuscateObject(42)).toBe(42);
      expect(ob.obfuscateObject(true)).toBe(true);
      expect(ob.obfuscateObject('hello 10.0.0.1')).toBe('hello [IP-1]');
    });

    it('should handle arrays', () => {
      const arr = ['line with 10.0.0.1', 'clean line', 'another 10.0.0.2'];
      const result = ob.obfuscateObject(arr);
      expect(result[0]).toBe('line with [IP-1]');
      expect(result[1]).toBe('clean line');
      expect(result[2]).toBe('another [IP-2]');
    });

    it('should handle empty objects and arrays', () => {
      expect(ob.obfuscateObject({})).toEqual({});
      expect(ob.obfuscateObject([])).toEqual([]);
    });
  });

  describe('Custom rules', () => {
    it('should apply static replacement rules', () => {
      ob.customRules = [
        { name: 'company', pattern: 'AcmeCorp', replacement: '[COMPANY]' },
      ];
      const result = ob.obfuscate('Login from AcmeCorp user');
      expect(result).toBe('Login from [COMPANY] user');
    });

    it('should apply numbered replacement rules', () => {
      ob.customRules = [
        { name: 'host', pattern: 'srv-\\w+\\.internal', replacement: '[HOST-N]' },
      ];
      const result = ob.obfuscate('Connected to srv-app01.internal and srv-db02.internal');
      expect(result).toContain('[HOST-1]');
      expect(result).toContain('[HOST-2]');
      expect(result).not.toContain('srv-app01');
    });

    it('should consistently map same value in numbered rules', () => {
      ob.customRules = [
        { name: 'host', pattern: 'srv-\\w+', replacement: '[HOST-N]' },
      ];
      ob.obfuscate('host srv-web01');
      const result = ob.obfuscate('retry srv-web01');
      expect(result).toBe('retry [HOST-1]');
    });

    it('should skip invalid regex in custom rules', () => {
      ob.customRules = [
        { name: 'bad', pattern: '[invalid', replacement: '[OOPS]' },
      ];
      const result = ob.obfuscate('normal text');
      expect(result).toBe('normal text');
    });

    it('should apply multiple custom rules in order', () => {
      ob.customRules = [
        { name: 'company', pattern: 'AcmeCorp', replacement: '[COMPANY]' },
        { name: 'env', pattern: 'prod|staging', replacement: '[ENV]' },
      ];
      const result = ob.obfuscate('AcmeCorp prod deployment');
      expect(result).toBe('[COMPANY] [ENV] deployment');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(ob.obfuscate('')).toBe('');
    });

    it('should handle string with no sensitive data', () => {
      const text = 'INFO 2024-01-15 Application started successfully';
      expect(ob.obfuscate(text)).toBe(text);
    });

    it('should handle very long lines', () => {
      const longLine = 'x'.repeat(10000) + ' 10.0.0.1 ' + 'y'.repeat(10000);
      const result = ob.obfuscate(longLine);
      expect(result).toContain('[IP-1]');
      expect(result).not.toContain('10.0.0.1');
    });

    it('should handle multiple IPs on the same line', () => {
      const line = '10.0.0.1 10.0.0.2 10.0.0.3 10.0.0.1';
      const result = ob.obfuscate(line);
      expect(result).toBe('[IP-1] [IP-2] [IP-3] [IP-1]');
    });

    it('should handle adjacent sensitive values', () => {
      // When IP and email are adjacent without separator, the email regex
      // may consume the IP as part of the local-part — this is expected
      // behavior since there's no word boundary between them
      const result = ob.obfuscate('10.0.0.1 alice@test.com');
      expect(result).toContain('[IP-1]');
      expect(result).toContain('[EMAIL-1]');
    });

    it('should not create false positives on version numbers', () => {
      // Version-like strings: "1.2.3.4" could match IPv4 — acceptable trade-off
      // but "v1.2.3" should NOT match
      const result = ob.obfuscate('version v1.2.3 released');
      expect(result).toBe('version v1.2.3 released');
    });

    it('should handle repeated obfuscate calls (idempotency on placeholders)', () => {
      const first = ob.obfuscate('host 10.0.0.1');
      expect(first).toBe('host [IP-1]');
      // Obfuscating already-redacted text should be stable — placeholders
      // contain no sensitive patterns so the text passes through unchanged
      const second = ob.obfuscate(first);
      expect(second).toBe('host [IP-1]');
    });
  });
});
