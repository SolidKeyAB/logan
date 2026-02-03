import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// === Site hostname mapping (from datadogClient.ts) ===

function getSiteHostname(site: string): string {
  const siteMap: Record<string, string> = {
    'US1': 'datadoghq.com',
    'US3': 'us3.datadoghq.com',
    'US5': 'us5.datadoghq.com',
    'EU1': 'datadoghq.eu',
    'AP1': 'ap1.datadoghq.com',
  };
  return siteMap[site] || site;
}

// === Log line formatting (from datadogClient.ts) ===

function formatLogLine(log: any): string {
  const timestamp = log.attributes?.timestamp || log.attributes?.date || '';
  const status = log.attributes?.status || '';
  const service = log.attributes?.service || '';
  const message = log.attributes?.message || '';

  const parts: string[] = [];
  if (timestamp) {
    if (typeof timestamp === 'number') {
      parts.push(new Date(timestamp).toISOString());
    } else {
      parts.push(String(timestamp));
    }
  }
  if (status) {
    parts.push(`[${String(status).toUpperCase()}]`);
  }
  if (service) {
    parts.push(`${service} -`);
  }
  if (message) {
    parts.push(String(message));
  } else {
    const attrs = { ...log.attributes };
    delete attrs.timestamp;
    delete attrs.date;
    delete attrs.status;
    delete attrs.service;
    delete attrs.message;
    if (Object.keys(attrs).length > 0) {
      parts.push(JSON.stringify(attrs));
    }
  }

  return parts.join(' ');
}

// === Config persistence (from datadogClient.ts) ===

interface DatadogConfig {
  site: string;
  apiKey: string;
  appKey: string;
}

// Use a temp directory for config tests
let testConfigDir: string;
let testConfigFile: string;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadDatadogConfig(configFile: string): DatadogConfig | null {
  try {
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // ignore
  }
  return null;
}

function saveDatadogConfig(configDir: string, configFile: string, config: DatadogConfig): void {
  ensureDir(configDir);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

function clearDatadogConfig(configFile: string): void {
  try {
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
    }
  } catch {
    // ignore
  }
}

// === Time range computation (from renderer.ts) ===

function getDatadogTimeRange(preset: string, customFrom?: string, customTo?: string): { from: string; to: string } {
  if (preset === 'custom' && customFrom && customTo) {
    return {
      from: new Date(customFrom).toISOString(),
      to: new Date(customTo).toISOString(),
    };
  }
  const now = new Date();
  const to = now.toISOString();
  const msMap: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  const offset = msMap[preset] || 60 * 60 * 1000;
  const from = new Date(now.getTime() - offset).toISOString();
  return { from, to };
}

// === IPC channel constants (from shared/types.ts) ===

const IPC_CHANNELS = {
  DATADOG_LOAD_CONFIG: 'datadog-load-config',
  DATADOG_SAVE_CONFIG: 'datadog-save-config',
  DATADOG_FETCH_LOGS: 'datadog-fetch-logs',
  DATADOG_FETCH_PROGRESS: 'datadog-fetch-progress',
  DATADOG_CANCEL_FETCH: 'datadog-cancel-fetch',
} as const;

// ============================================================
// Tests
// ============================================================

describe('Datadog Integration', () => {

  describe('Site Hostname Mapping', () => {
    it('should map US1 to datadoghq.com', () => {
      expect(getSiteHostname('US1')).toBe('datadoghq.com');
    });

    it('should map US3 to us3.datadoghq.com', () => {
      expect(getSiteHostname('US3')).toBe('us3.datadoghq.com');
    });

    it('should map US5 to us5.datadoghq.com', () => {
      expect(getSiteHostname('US5')).toBe('us5.datadoghq.com');
    });

    it('should map EU1 to datadoghq.eu', () => {
      expect(getSiteHostname('EU1')).toBe('datadoghq.eu');
    });

    it('should map AP1 to ap1.datadoghq.com', () => {
      expect(getSiteHostname('AP1')).toBe('ap1.datadoghq.com');
    });

    it('should return custom site value as-is for unknown sites', () => {
      expect(getSiteHostname('custom.example.com')).toBe('custom.example.com');
    });
  });

  describe('Log Line Formatting', () => {
    it('should format a complete log entry with all fields', () => {
      const log = {
        attributes: {
          timestamp: '2024-01-25T10:30:45.123Z',
          status: 'error',
          service: 'my-service',
          message: 'Connection refused',
        }
      };
      const line = formatLogLine(log);
      expect(line).toBe('2024-01-25T10:30:45.123Z [ERROR] my-service - Connection refused');
    });

    it('should convert numeric timestamps to ISO format', () => {
      const epochMs = new Date('2024-06-15T12:00:00Z').getTime();
      const log = {
        attributes: {
          timestamp: epochMs,
          status: 'info',
          message: 'Test message',
        }
      };
      const line = formatLogLine(log);
      expect(line).toContain('2024-06-15T12:00:00');
      expect(line).toContain('[INFO]');
      expect(line).toContain('Test message');
    });

    it('should handle missing status field', () => {
      const log = {
        attributes: {
          timestamp: '2024-01-25T10:30:45Z',
          service: 'api',
          message: 'Request processed',
        }
      };
      const line = formatLogLine(log);
      expect(line).toBe('2024-01-25T10:30:45Z api - Request processed');
      expect(line).not.toContain('[');
    });

    it('should handle missing service field', () => {
      const log = {
        attributes: {
          timestamp: '2024-01-25T10:30:45Z',
          status: 'warn',
          message: 'High memory usage',
        }
      };
      const line = formatLogLine(log);
      expect(line).toBe('2024-01-25T10:30:45Z [WARN] High memory usage');
    });

    it('should handle missing message by serializing remaining attributes', () => {
      const log = {
        attributes: {
          timestamp: '2024-01-25T10:30:45Z',
          status: 'debug',
          host: 'web-01',
          duration_ms: 150,
        }
      };
      const line = formatLogLine(log);
      expect(line).toContain('[DEBUG]');
      expect(line).toContain('web-01');
      expect(line).toContain('150');
    });

    it('should handle empty attributes gracefully', () => {
      const log = { attributes: {} };
      const line = formatLogLine(log);
      expect(line).toBe('');
    });

    it('should handle missing attributes object', () => {
      const log = {};
      const line = formatLogLine(log);
      expect(line).toBe('');
    });

    it('should use date field as fallback for timestamp', () => {
      const log = {
        attributes: {
          date: '2024-03-10T08:00:00Z',
          status: 'info',
          message: 'Fallback timestamp',
        }
      };
      const line = formatLogLine(log);
      expect(line).toContain('2024-03-10T08:00:00Z');
      expect(line).toContain('Fallback timestamp');
    });

    it('should produce LOGAN-compatible output with detectable log levels', () => {
      const errorLog = formatLogLine({
        attributes: { timestamp: '2024-01-01T00:00:00Z', status: 'error', message: 'fail' }
      });
      const warnLog = formatLogLine({
        attributes: { timestamp: '2024-01-01T00:00:00Z', status: 'warning', message: 'caution' }
      });
      const infoLog = formatLogLine({
        attributes: { timestamp: '2024-01-01T00:00:00Z', status: 'info', message: 'ok' }
      });

      // LOGAN detects levels from [LEVEL] patterns
      expect(errorLog).toContain('[ERROR]');
      expect(warnLog).toContain('[WARNING]');
      expect(infoLog).toContain('[INFO]');
    });
  });

  describe('Config Persistence', () => {
    beforeEach(() => {
      testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-test-'));
      testConfigFile = path.join(testConfigDir, 'datadog.json');
    });

    afterEach(() => {
      // Clean up temp dir
      try {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    });

    it('should return null when no config file exists', () => {
      const config = loadDatadogConfig(testConfigFile);
      expect(config).toBeNull();
    });

    it('should save and load config correctly', () => {
      const config: DatadogConfig = {
        site: 'US1',
        apiKey: 'test-api-key-123',
        appKey: 'test-app-key-456',
      };
      saveDatadogConfig(testConfigDir, testConfigFile, config);

      const loaded = loadDatadogConfig(testConfigFile);
      expect(loaded).not.toBeNull();
      expect(loaded!.site).toBe('US1');
      expect(loaded!.apiKey).toBe('test-api-key-123');
      expect(loaded!.appKey).toBe('test-app-key-456');
    });

    it('should overwrite existing config on save', () => {
      saveDatadogConfig(testConfigDir, testConfigFile, {
        site: 'US1', apiKey: 'old-key', appKey: 'old-app',
      });
      saveDatadogConfig(testConfigDir, testConfigFile, {
        site: 'EU1', apiKey: 'new-key', appKey: 'new-app',
      });

      const loaded = loadDatadogConfig(testConfigFile);
      expect(loaded!.site).toBe('EU1');
      expect(loaded!.apiKey).toBe('new-key');
    });

    it('should clear config by removing the file', () => {
      saveDatadogConfig(testConfigDir, testConfigFile, {
        site: 'US1', apiKey: 'key', appKey: 'app',
      });
      expect(fs.existsSync(testConfigFile)).toBe(true);

      clearDatadogConfig(testConfigFile);
      expect(fs.existsSync(testConfigFile)).toBe(false);

      const loaded = loadDatadogConfig(testConfigFile);
      expect(loaded).toBeNull();
    });

    it('should handle clearing when no config exists', () => {
      // Should not throw
      clearDatadogConfig(testConfigFile);
      expect(fs.existsSync(testConfigFile)).toBe(false);
    });

    it('should store config as valid JSON', () => {
      saveDatadogConfig(testConfigDir, testConfigFile, {
        site: 'AP1', apiKey: 'abc', appKey: 'xyz',
      });

      const raw = fs.readFileSync(testConfigFile, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.site).toBe('AP1');
      expect(parsed.apiKey).toBe('abc');
      expect(parsed.appKey).toBe('xyz');
    });

    it('should return null for corrupted config file', () => {
      fs.writeFileSync(testConfigFile, 'not valid json{{{', 'utf-8');
      const config = loadDatadogConfig(testConfigFile);
      expect(config).toBeNull();
    });
  });

  describe('Time Range Computation', () => {
    it('should compute 15-minute window', () => {
      const before = Date.now();
      const { from, to } = getDatadogTimeRange('15m');
      const after = Date.now();

      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      const diffMs = toMs - fromMs;

      // Should be approximately 15 minutes
      expect(diffMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 100);
      expect(diffMs).toBeLessThanOrEqual(15 * 60 * 1000 + 100);

      // "to" should be close to now
      expect(toMs).toBeGreaterThanOrEqual(before);
      expect(toMs).toBeLessThanOrEqual(after + 100);
    });

    it('should compute 1-hour window', () => {
      const { from, to } = getDatadogTimeRange('1h');
      const diffMs = new Date(to).getTime() - new Date(from).getTime();
      expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 100);
      expect(diffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 100);
    });

    it('should compute 4-hour window', () => {
      const { from, to } = getDatadogTimeRange('4h');
      const diffMs = new Date(to).getTime() - new Date(from).getTime();
      expect(diffMs).toBeGreaterThanOrEqual(4 * 60 * 60 * 1000 - 100);
      expect(diffMs).toBeLessThanOrEqual(4 * 60 * 60 * 1000 + 100);
    });

    it('should compute 1-day window', () => {
      const { from, to } = getDatadogTimeRange('1d');
      const diffMs = new Date(to).getTime() - new Date(from).getTime();
      expect(diffMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 100);
      expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 100);
    });

    it('should compute 7-day window', () => {
      const { from, to } = getDatadogTimeRange('7d');
      const diffMs = new Date(to).getTime() - new Date(from).getTime();
      expect(diffMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 100);
      expect(diffMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 100);
    });

    it('should use custom from/to for custom preset', () => {
      const customFrom = '2024-06-01T00:00:00';
      const customTo = '2024-06-02T12:00:00';
      const { from, to } = getDatadogTimeRange('custom', customFrom, customTo);

      expect(new Date(from).getFullYear()).toBe(2024);
      expect(new Date(from).getMonth()).toBe(5); // June
      expect(new Date(from).getDate()).toBe(1);
      expect(new Date(to).getDate()).toBe(2);
    });

    it('should fall back to 1-hour for unknown preset', () => {
      const { from, to } = getDatadogTimeRange('unknown_value');
      const diffMs = new Date(to).getTime() - new Date(from).getTime();
      // Falls back to 1 hour (default in msMap fallback)
      expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 100);
      expect(diffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 100);
    });

    it('should return valid ISO timestamps', () => {
      const { from, to } = getDatadogTimeRange('1h');
      // ISO strings end with Z or have timezone offset
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('IPC Channel Constants', () => {
    it('should have all required Datadog channels', () => {
      expect(IPC_CHANNELS.DATADOG_LOAD_CONFIG).toBe('datadog-load-config');
      expect(IPC_CHANNELS.DATADOG_SAVE_CONFIG).toBe('datadog-save-config');
      expect(IPC_CHANNELS.DATADOG_FETCH_LOGS).toBe('datadog-fetch-logs');
      expect(IPC_CHANNELS.DATADOG_FETCH_PROGRESS).toBe('datadog-fetch-progress');
      expect(IPC_CHANNELS.DATADOG_CANCEL_FETCH).toBe('datadog-cancel-fetch');
    });

    it('should have unique channel names', () => {
      const values = Object.values(IPC_CHANNELS);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });
  });

  describe('Output File Path Safety', () => {
    it('should sanitize query for filename', () => {
      // Reproduce the sanitization logic from datadogClient.ts
      const query = 'service:web-app status:error @http.method:POST';
      const safeQuery = query.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      expect(safeQuery).not.toContain(':');
      expect(safeQuery).not.toContain(' ');
      expect(safeQuery).not.toContain('@');
      expect(safeQuery.length).toBeLessThanOrEqual(30);
    });

    it('should truncate long queries in filename', () => {
      const query = 'a'.repeat(100);
      const safeQuery = query.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      expect(safeQuery.length).toBe(30);
    });

    it('should handle empty query', () => {
      const query = '';
      const safeQuery = query.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      expect(safeQuery).toBe('');
    });

    it('should preserve alphanumeric and hyphens/underscores', () => {
      const query = 'my-service_logs';
      const safeQuery = query.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      expect(safeQuery).toBe('my-service_logs');
    });
  });
});
