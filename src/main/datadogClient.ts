import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { net } from 'electron';

export interface DatadogConfig {
  site: string; // e.g. 'datadoghq.com', 'us3.datadoghq.com', etc.
  apiKey: string;
  appKey: string;
}

export interface DatadogFetchParams {
  query: string;
  from: string; // ISO timestamp
  to: string;   // ISO timestamp
  maxLogs: number;
}

export interface DatadogFetchResult {
  success: boolean;
  filePath?: string;
  logCount?: number;
  error?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.logan');
const CONFIG_FILE = path.join(CONFIG_DIR, 'datadog.json');
const DATADOG_DIR = path.join(CONFIG_DIR, 'datadog');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadDatadogConfig(): DatadogConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load Datadog config:', error);
  }
  return null;
}

export function saveDatadogConfig(config: DatadogConfig): void {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function clearDatadogConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch (error) {
    console.error('Failed to clear Datadog config:', error);
  }
}

// Map site short names to API hostnames
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

// Make an HTTP request using Electron's net module
function makeRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: { cancelled: boolean }
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (signal.cancelled) {
      reject(new Error('Cancelled'));
      return;
    }

    const request = net.request({
      method: 'POST',
      url,
    });

    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }

    let responseBody = '';
    let statusCode = 0;

    request.on('response', (response) => {
      statusCode = response.statusCode;

      response.on('data', (chunk: Buffer) => {
        responseBody += chunk.toString();
      });

      response.on('end', () => {
        resolve({ statusCode, body: responseBody });
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.write(body);
    request.end();
  });
}

// Format a Datadog log entry into a LOGAN-compatible line
function formatLogLine(log: any): string {
  const timestamp = log.attributes?.timestamp || log.attributes?.date || '';
  const status = log.attributes?.status || '';
  const service = log.attributes?.service || '';
  const message = log.attributes?.message || '';

  // Build a line compatible with LOGAN's timestamp/level detection
  const parts: string[] = [];
  if (timestamp) {
    // Convert to ISO format if it's a number (epoch ms)
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
    // Fallback: serialize remaining attributes
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

export async function fetchDatadogLogs(
  config: DatadogConfig,
  params: DatadogFetchParams,
  onProgress: (message: string, count: number) => void,
  signal: { cancelled: boolean }
): Promise<DatadogFetchResult> {
  const hostname = getSiteHostname(config.site);
  const baseUrl = `https://api.${hostname}/api/v2/logs/events/search`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'DD-API-KEY': config.apiKey,
    'DD-APPLICATION-KEY': config.appKey,
  };

  const allLogs: string[] = [];
  let cursor: string | undefined;
  const pageSize = Math.min(params.maxLogs, 1000); // API max per page is 1000

  try {
    while (allLogs.length < params.maxLogs) {
      if (signal.cancelled) {
        return { success: false, error: 'Fetch cancelled' };
      }

      const requestBody: any = {
        filter: {
          query: params.query,
          from: params.from,
          to: params.to,
        },
        sort: 'timestamp',
        page: {
          limit: Math.min(pageSize, params.maxLogs - allLogs.length),
        },
      };

      if (cursor) {
        requestBody.page.cursor = cursor;
      }

      onProgress(`Fetching logs... (${allLogs.length} so far)`, allLogs.length);

      const response = await makeRequest(
        baseUrl,
        headers,
        JSON.stringify(requestBody),
        signal
      );

      if (response.statusCode === 403) {
        return { success: false, error: 'Authentication failed: invalid API key or Application key' };
      }
      if (response.statusCode === 429) {
        return { success: false, error: 'Rate limited by Datadog API. Please wait and try again.' };
      }
      if (response.statusCode !== 200) {
        let errorMsg = `Datadog API error (HTTP ${response.statusCode})`;
        try {
          const errBody = JSON.parse(response.body);
          if (errBody.errors) {
            errorMsg += `: ${errBody.errors.join(', ')}`;
          }
        } catch { /* ignore parse errors */ }
        return { success: false, error: errorMsg };
      }

      let data: any;
      try {
        data = JSON.parse(response.body);
      } catch {
        return { success: false, error: 'Invalid response from Datadog API' };
      }

      const logs = data.data || [];
      if (logs.length === 0) {
        break;
      }

      for (const log of logs) {
        allLogs.push(formatLogLine(log));
        if (allLogs.length >= params.maxLogs) break;
      }

      // Check for next page
      cursor = data.meta?.page?.after;
      if (!cursor) {
        break;
      }
    }

    if (allLogs.length === 0) {
      return { success: false, error: 'No logs found for the given query and time range.' };
    }

    // Write to file
    ensureDir(DATADOG_DIR);
    const safeQuery = params.query.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `dd_${safeQuery}_${timestamp}.log`;
    const filePath = path.join(DATADOG_DIR, fileName);

    onProgress(`Writing ${allLogs.length} logs to file...`, allLogs.length);
    fs.writeFileSync(filePath, allLogs.join('\n'), 'utf-8');

    return { success: true, filePath, logCount: allLogs.length };
  } catch (error: any) {
    if (signal.cancelled) {
      return { success: false, error: 'Fetch cancelled' };
    }
    if (error.message?.includes('net::')) {
      return { success: false, error: `Network error: ${error.message}` };
    }
    return { success: false, error: `Error: ${error.message || String(error)}` };
  }
}
