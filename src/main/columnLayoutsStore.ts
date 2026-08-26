// Column Layouts store — a named, saved definition of a file's columns (delimiter or
// regex/paint pattern) + per-column {index, name, visible}. Shared by the human IPC path
// (Columns window) and the AI /api path, so both operators use ONE implementation.
// Global JSON at ~/.logan/column-layouts.json. Local-only, no network.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ColumnLayoutSaved {
  id: string;
  name: string;
  method: 'delimiter' | 'pattern';
  delimiter?: string;
  delimiterName?: string;
  pattern?: { regex: string; flags: string; fields: string[] };
  columns: Array<{ index: number; name?: string; visible: boolean; muted?: boolean }>;
  description?: string; // optional human/AI note: what this is for / why it was added
}

const LAYOUTS_PATH = (): string => path.join(os.homedir(), '.logan', 'column-layouts.json');

export function loadColumnLayouts(): ColumnLayoutSaved[] {
  try {
    const p = LAYOUTS_PATH();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error('Failed to load column layouts:', error);
  }
  return [];
}

export function saveColumnLayouts(items: ColumnLayoutSaved[]): void {
  try {
    const p = LAYOUTS_PATH();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(items, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save column layouts:', error);
  }
}

/** Upsert one layout (by id). Returns the full list. */
export function upsertColumnLayout(layout: ColumnLayoutSaved): ColumnLayoutSaved[] {
  const items = loadColumnLayouts();
  const idx = items.findIndex(l => l.id === layout.id);
  if (idx >= 0) items[idx] = layout; else items.push(layout);
  saveColumnLayouts(items);
  return items;
}

/** Delete a layout by id. Returns the remaining list. */
export function deleteColumnLayout(id: string): ColumnLayoutSaved[] {
  const items = loadColumnLayouts().filter(l => l.id !== id);
  saveColumnLayouts(items);
  return items;
}
