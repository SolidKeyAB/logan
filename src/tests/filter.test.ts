import { describe, it, expect } from 'vitest';

// Filter rule types
type FilterRuleType = 'contains' | 'not_contains' | 'level' | 'not_level' | 'regex' | 'not_regex';

interface FilterRule {
  id: string;
  type: FilterRuleType;
  value: string;
  caseSensitive?: boolean;
}

interface FilterGroup {
  id: string;
  operator: 'AND' | 'OR';
  rules: FilterRule[];
}

interface AdvancedFilterConfig {
  enabled: boolean;
  groups: FilterGroup[];
}

// Compile filter for performance (from main/index.ts)
function compileAdvancedFilter(config: AdvancedFilterConfig): (line: string, level: string) => boolean {
  if (!config.enabled || config.groups.length === 0) {
    return () => true;
  }

  const compiledGroups = config.groups.map(group => {
    const compiledRules = group.rules.map(rule => {
      // Pre-compile regex if needed
      if (rule.type === 'regex' || rule.type === 'not_regex') {
        try {
          const regex = new RegExp(rule.value, rule.caseSensitive ? '' : 'i');
          return rule.type === 'regex'
            ? (text: string, _level: string) => regex.test(text)
            : (text: string, _level: string) => !regex.test(text);
        } catch {
          return () => false; // Invalid regex
        }
      }

      // Pre-lowercase for contains
      const pattern = rule.caseSensitive ? rule.value : rule.value.toLowerCase();

      switch (rule.type) {
        case 'contains':
          return (text: string, _level: string) =>
            (rule.caseSensitive ? text : text.toLowerCase()).includes(pattern);
        case 'not_contains':
          return (text: string, _level: string) =>
            !(rule.caseSensitive ? text : text.toLowerCase()).includes(pattern);
        case 'level':
          return (_text: string, level: string) => level.toLowerCase() === rule.value.toLowerCase();
        case 'not_level':
          return (_text: string, level: string) => level.toLowerCase() !== rule.value.toLowerCase();
        default:
          return () => true;
      }
    });

    // Return group evaluator
    return group.operator === 'AND'
      ? (text: string, level: string) => compiledRules.every(fn => fn(text, level))
      : (text: string, level: string) => compiledRules.some(fn => fn(text, level));
  });

  // Groups are AND'd together
  return (text: string, level: string) => compiledGroups.every(fn => fn(text, level));
}

describe('Advanced Filter Compilation', () => {
  describe('Basic Contains Filter', () => {
    it('should match lines containing pattern', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'contains', value: 'error' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Connection error occurred', 'info')).toBe(true);
      expect(filter('Everything is fine', 'info')).toBe(false);
    });

    it('should be case-insensitive by default', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'contains', value: 'ERROR' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('error in module', 'info')).toBe(true);
      expect(filter('ERROR in module', 'info')).toBe(true);
    });

    it('should respect case-sensitive option', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'contains', value: 'ERROR', caseSensitive: true }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('ERROR in module', 'info')).toBe(true);
      expect(filter('error in module', 'info')).toBe(false);
    });
  });

  describe('Not Contains Filter', () => {
    it('should exclude lines containing pattern', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'not_contains', value: 'heartbeat' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('System heartbeat', 'info')).toBe(false);
      expect(filter('Connection established', 'info')).toBe(true);
    });
  });

  describe('Level Filter', () => {
    it('should match specific log level', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'level', value: 'error' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Any message', 'error')).toBe(true);
      expect(filter('Any message', 'ERROR')).toBe(true);
      expect(filter('Any message', 'info')).toBe(false);
    });

    it('should exclude specific log level with not_level', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'not_level', value: 'debug' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Any message', 'debug')).toBe(false);
      expect(filter('Any message', 'info')).toBe(true);
      expect(filter('Any message', 'error')).toBe(true);
    });
  });

  describe('Regex Filter', () => {
    it('should match regex patterns', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'regex', value: 'user_\\d+' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Login by user_123', 'info')).toBe(true);
      expect(filter('Login by admin', 'info')).toBe(false);
    });

    it('should exclude regex patterns with not_regex', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'not_regex', value: '\\d{4}-\\d{2}-\\d{2}' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Event at 2024-01-15', 'info')).toBe(false);
      expect(filter('Event at unknown time', 'info')).toBe(true);
    });
  });

  describe('AND Operator', () => {
    it('should require all rules to match', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [
            { id: 'r1', type: 'contains', value: 'connection' },
            { id: 'r2', type: 'contains', value: 'failed' }
          ]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Connection failed', 'error')).toBe(true);
      expect(filter('Connection established', 'info')).toBe(false);
      expect(filter('Request failed', 'error')).toBe(false);
    });
  });

  describe('OR Operator', () => {
    it('should match if any rule matches', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [{
          id: '1',
          operator: 'OR',
          rules: [
            { id: 'r1', type: 'level', value: 'error' },
            { id: 'r2', type: 'level', value: 'warning' }
          ]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Any message', 'error')).toBe(true);
      expect(filter('Any message', 'warning')).toBe(true);
      expect(filter('Any message', 'info')).toBe(false);
    });
  });

  describe('Multiple Groups (AND between groups)', () => {
    it('should require all groups to match', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: [
          {
            id: '1',
            operator: 'OR',
            rules: [
              { id: 'r1', type: 'level', value: 'error' },
              { id: 'r2', type: 'level', value: 'warning' }
            ]
          },
          {
            id: '2',
            operator: 'AND',
            rules: [
              { id: 'r3', type: 'contains', value: 'timeout' }
            ]
          }
        ]
      };
      const filter = compileAdvancedFilter(config);

      // (error OR warning) AND (contains timeout)
      expect(filter('Connection timeout', 'error')).toBe(true);
      expect(filter('Request timeout', 'warning')).toBe(true);
      expect(filter('Connection timeout', 'info')).toBe(false);
      expect(filter('Connection failed', 'error')).toBe(false);
    });
  });

  describe('Disabled Filter', () => {
    it('should pass all lines when disabled', () => {
      const config: AdvancedFilterConfig = {
        enabled: false,
        groups: [{
          id: '1',
          operator: 'AND',
          rules: [{ id: 'r1', type: 'contains', value: 'error' }]
        }]
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('No error here', 'info')).toBe(true);
    });

    it('should pass all lines when no groups', () => {
      const config: AdvancedFilterConfig = {
        enabled: true,
        groups: []
      };
      const filter = compileAdvancedFilter(config);

      expect(filter('Any message', 'info')).toBe(true);
    });
  });
});
