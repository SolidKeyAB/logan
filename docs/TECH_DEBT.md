# Technical Debt

Known issues that aren't urgent but should be addressed as the codebase grows.

## Renderer (`src/renderer/renderer.ts`)

### Global Mutable State Without Protection

**Severity**: Medium | **Effort**: Large

The renderer uses ~30+ mutable global variables (`state`, `terminal`, `fitAddon`, `splitDiffState`, `zoomLevel`, etc.) with no encapsulation. Any function can mutate any state, making it hard to trace bugs.

**What to do**: Introduce a state management layer — at minimum a centralized state object with accessor functions that validate mutations. A full reactive/reducer pattern would be ideal but is a significant rewrite.

### Duplicated Modal Pattern

**Severity**: Low | **Effort**: Medium

Multiple modals (highlight modal, bookmark modal, rename modal, etc.) each implement their own promise-based show/hide pattern with `pendingResolve` variables. The pattern is copy-pasted across each modal type.

**What to do**: Create a generic `showModal<T>(element, setup): Promise<T | null>` helper that handles the promise lifecycle, backdrop clicks, Escape key, and resolve/reject. Each modal specializes only its content and result extraction.

### Path Comparison via String Equality

**Severity**: Low | **Effort**: Small

File paths are compared with `===` throughout (e.g., `file.path === state.filePath`). This can fail with path normalization differences, trailing slashes, symlinks, or mixed separators on Windows.

**What to do**: Normalize all paths on entry (e.g., when files are opened) and use a `pathsEqual()` utility for comparisons. Electron's `path` module handles cross-platform normalization.

### `void offsetHeight` Reflow Hacks

**Severity**: Low | **Effort**: Small

Two places use `void overlay.offsetHeight` to force a browser reflow before adding a CSS class, so that CSS transitions trigger from the initial state. This is a well-known browser pattern but is fragile — future CSS changes could make the reflow unnecessary or insufficient.

**What to do**: These are acceptable for now. If they become problematic, replace with a double-`requestAnimationFrame` pattern or use the Web Animations API.

### Feature Coupling: Word Wrap and Markdown Preview

**Severity**: Low | **Effort**: Small

`wordWrapEnabled` boolean is checked in both the word-wrap toggle and markdown preview code paths. These are separate features that share a rendering concern (line wrapping) but aren't the same thing.

**What to do**: If markdown preview evolves to need different wrapping behavior, split into separate state flags.

### Mutation of Filter Rules During Render

**Severity**: Low | **Effort**: Medium

When filter rule types change (e.g., switching from text to level), `updateFilterRule()` mutates state and triggers `renderAdvancedFilterUI()` inline. If another state change happens during that render cycle, the UI can desync.

**What to do**: Batch filter state mutations and render once at the end of the current event loop tick (e.g., via `queueMicrotask`).

### Context Menu `setTimeout(0)` for Click-Outside

**Severity**: Low | **Effort**: Small

Line ~3422 uses `setTimeout(() => document.addEventListener('click', closeMenu), 0)` to defer adding the click-outside handler until after the current click event finishes. This works but is a timing-based workaround.

**What to do**: Use `{ once: true }` on the originating event or `pointer-events` CSS to prevent the immediate re-trigger, removing the need for the setTimeout.
