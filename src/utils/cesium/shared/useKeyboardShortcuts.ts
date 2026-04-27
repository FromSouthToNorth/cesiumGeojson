/* ==============================
 * Keyboard Shortcuts Composable
 * Declarative keyboard shortcut definitions with cross-platform
 * modifier key support (Ctrl on Win/Linux, Cmd on Mac).
 * ============================== */

export interface ShortcutDef {
  /** e.key value to match, e.g. 'z', 'Escape', 'Delete' */
  key: string;
  /** Require Ctrl (Win/Linux) or Cmd (Mac) — platform-aware */
  meta?: boolean;
  /** Require Shift */
  shift?: boolean;
  /** Fired when the shortcut is matched */
  handler: (e: KeyboardEvent) => void;
}

/**
 * Declarative keyboard shortcuts composable.
 *
 * Platform detection:
 *   - `meta: true` checks `metaKey` on Mac, `ctrlKey` on Win/Linux
 *   - Non-meta shortcuts are blocked when any modifier key is pressed
 *     to avoid conflicting with browser/OS shortcuts
 *
 * Usage:
 *   const kb = useKeyboardShortcuts([
 *     { key: 'Escape', handler: () => stopEdit() },
 *     { key: 'z', meta: true, handler: () => undo() },
 *   ]);
 *   kb.setup();   // activate (e.g. on mode enter)
 *   kb.teardown(); // deactivate (e.g. on mode exit)
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDef[]) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  let active = false;

  function onKeyDown(e: KeyboardEvent) {
    for (const def of shortcuts) {
      if (e.key !== def.key) continue;

      // Meta modifier: Ctrl on Win/Linux, Cmd on Mac
      if (def.meta) {
        const matched = isMac ? e.metaKey : e.ctrlKey;
        if (!matched) continue;
      } else {
        // Non-meta shortcuts: skip when any modifier is pressed
        // to avoid conflicting with browser/OS shortcuts
        if (e.metaKey || e.ctrlKey || e.altKey) continue;
      }

      // Shift modifier
      if (def.shift && !e.shiftKey) continue;

      e.preventDefault();
      def.handler(e);
      return;
    }
  }

  function setup() {
    if (active) return;
    active = true;
    window.addEventListener('keydown', onKeyDown);
  }

  function teardown() {
    if (!active) return;
    active = false;
    window.removeEventListener('keydown', onKeyDown);
  }

  return { setup, teardown };
}
