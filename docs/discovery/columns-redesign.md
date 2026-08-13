# Columns, redesigned — one feature, two parts, template-driven

Design from user (phone, 2026-08-12): "columns visibility window should only use templates.
There can be a default template the user plays with, or creates new on the [pattern column]
panel and uses on the visibility window. Keep column features close. I don't like the name
'Pattern Columns'. Keep it split into two parts like now."

## Problem — two disconnected column systems today
- **"Pattern Columns"** panel: identify columns via grok / regex / paint, name them, save
  globally — but it has **no apply path** (preview only; a saved pattern just reloads into the
  editor, `patcolLoadSaved`). Regex-based.
- **"Columns"** visibility window (`showColumnsModal`): auto-detects **delimiter** columns,
  show/hide via one injected CSS rule (`updateColumnHideStyle`, instant). Not template-driven;
  names/visibility not persisted per-file.

They use different column models (regex vs delimiter) and don't talk to each other.

## The shared object: a "Column Layout"
The one thing the two parts exchange — a named, saved definition of a file's columns:

    ColumnLayout {
      id, name,
      scope: 'file' | 'global',
      method: 'delimiter' | 'pattern',
      delimiter?: string,                       // method = delimiter
      pattern?: { mode, spec, regex, flags },   // method = pattern (from the builder)
      columns: [{ key, name, visible }],        // key = column index (delimiter) or capture name (pattern)
    }

One model covers BOTH identification methods + names + visibility.

## Two parts (kept split, unified under one "Columns" umbrella)

### 1) Column Builder  — renamed from "Pattern Columns"
- Identify columns: auto-delimiter OR grok / regex / paint (as today) + a plain "by delimiter" mode.
- Name each column; set default visibility.
- **Save as a Column Layout** (per-file OR global). This replaces today's regex-only "Saved:" chips.

### 2) Columns  — the visibility window
- **Only applies Layouts.** A template picker lists: **"Default (auto)"** + saved layouts (file + global).
- Pick a layout → the viewer renders its columns and applies its visibility.
- Toggling show/hide here updates the active layout; **Save** writes it back (file/global).

## Default template
On opening a delimited file, auto-build a **"Default (auto-detect)"** layout from the detected
delimiter, so the visibility window is immediately usable. User tweaks it and **Save as…** to
create their own — exactly the "a default to play with, or create new" the user described.

## Keeping them close
Both under a single **"Columns"** umbrella. The visibility window has an **"Edit / New layout…"**
link that opens the Builder pre-loaded with the current columns. One mental model: *define a
layout → apply it.*

## Rename ("Pattern Columns" — user dislikes it)
Proposed: the builder = **"Column Layouts"** (or "Define Columns"); the saved object = a **"Layout"**.
The visibility window stays **"Columns"**. — user to pick the final label.

## Build phases
- **Phase 1 (tractable, safe): delimiter layouts, template-driven.** Layout store (file + global);
  the visibility window becomes template-driven (picker, default auto-layout, apply, save-back)
  using the EXISTING delimiter rendering. Builder saves delimiter layouts (names + visibility).
  **No rendering-path change.** Delivers the whole UX for the common (delimiter) case.
- **Phase 2 (bigger): pattern layouts.** Add `method: 'pattern'` — grok/regex/paint layouts render
  as columns via capture-group char ranges (generalize `computeColumnSegments` to accept a pattern)
  so they too show/hide in the visibility window. This is the delicate rendering change
  (column-splitting has caused wrong-column-hiding bugs before) — do it with tests, after Phase 1.

## Reuse (little is thrown away)
- **I1 (already shipped on this branch, `8b9b808`)**: per-column names + filter-rows-by-column fold
  straight in — names live on the Layout; the row-filter uses the Layout's columns.
- `computeColumnSegments` / `updateColumnHideStyle` (delimiter render + instant CSS hide),
  `splitLineIntoColumns` (canonical splitter), the `~/.logan/column-patterns.json` global store
  (becomes the pattern-layout store), `analyze-columns` (default layout source).
