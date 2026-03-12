import { useEffect } from "react";
import { useLayoutStore } from "../../store/layoutStore";

/**
 * Registers global keyboard shortcuts for layout panel toggling.
 *
 * Shortcuts:
 *   Ctrl+B          Toggle sidebar
 *   Ctrl+Shift+B    Toggle inspector
 *   Ctrl+J          Toggle bottom panel
 *   Ctrl+Shift+M    Exit maximize (if maximized)
 *   Escape          Exit maximize (if maximized)
 */
export function useLayoutShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if focus is in an input, textarea, or select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.ctrlKey && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        useLayoutStore.getState().toggleSidebar();
      } else if (e.ctrlKey && e.shiftKey && e.key === "B") {
        e.preventDefault();
        useLayoutStore.getState().toggleInspector();
      } else if (e.ctrlKey && !e.shiftKey && e.key === "j") {
        e.preventDefault();
        useLayoutStore.getState().toggleBottomPanel();
      } else if (e.ctrlKey && e.shiftKey && e.key === "M") {
        e.preventDefault();
        const { maximizedView, setMaximizedView } = useLayoutStore.getState();
        if (maximizedView) setMaximizedView(null);
      } else if (e.key === "Escape") {
        const { maximizedView, setMaximizedView } = useLayoutStore.getState();
        if (maximizedView) {
          e.preventDefault();
          setMaximizedView(null);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
