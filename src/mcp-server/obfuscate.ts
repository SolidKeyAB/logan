import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Built-in redaction patterns
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

interface RedactionConfig {
  enabled: boolean;
  rules: CustomRule[];
}

function loadCustomRules(): CustomRule[] {
  try {
    const rulesPath = path.join(os.homedir(), '.logan', 'redaction-rules.json');
    if (fs.existsSync(rulesPath)) {
      const data: RedactionConfig = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      if (data.enabled && Array.isArray(data.rules)) {
        return data.rules;
      }
    }
  } catch {
    // Ignore errors — no custom rules
  }
  return [];
}

export class Obfuscator {
  // Maps original value → placeholder for consistent replacement within a session
  private sessionMaps: Map<string, Map<string, string>> = new Map();
  private customRules: CustomRule[];

  constructor() {
    this.customRules = loadCustomRules();
  }

  /** Reset all session mappings (call between unrelated requests if desired) */
  reset(): void {
    this.sessionMaps.clear();
  }

  /** Reload custom rules from disk */
  reloadRules(): void {
    this.customRules = loadCustomRules();
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

  /** Obfuscate a single string */
  obfuscate(text: string): string {
    let result = text;

    // Apply built-in patterns
    for (const { regex, prefix } of BUILTIN_PATTERNS) {
      // Reset regex lastIndex for global patterns
      regex.lastIndex = 0;
      result = result.replace(regex, (match) => this.getOrCreateMapping(prefix, match));
    }

    // Apply custom rules
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
        // Skip invalid regex patterns
      }
    }

    return result;
  }

  /** Obfuscate an array of line objects (mutates lineText/text fields) */
  obfuscateLines(lines: Array<{ text?: string; lineText?: string; [key: string]: any }>): void {
    for (const line of lines) {
      if (line.text) line.text = this.obfuscate(line.text);
      if (line.lineText) line.lineText = this.obfuscate(line.lineText);
    }
  }

  /** Obfuscate any object deeply — replaces string values that look like data */
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
