import { useCallback, useRef, type PropsWithChildren, type ReactNode } from "react";
import type { LayoutDTO } from "../../api/types";
import { useLayoutStore } from "../../store/layoutStore";
import { ResizeHandle } from "./ResizeHandle";
import { LayoutPresetPicker } from "./LayoutPresetPicker";
import { useLayoutShortcuts } from "./useLayoutShortcuts";

type LayoutShellProps = PropsWithChildren<{
  title: string;
  sessionId: string;
  layout: LayoutDTO;
  toolbar?: ReactNode;
  /**
   * Left navigation/control rail.
   * Owns shared navigation controls (selection, layout preset, processing).
   * Should not contain view-specific tool controls.
   */
  nav: ReactNode;
  /**
   * Right inspector/details rail.
   * Owns context-sensitive detail panels (event table, tensor inspector).
   * Content changes based on the active selection, not on which view is focused.
   */
  inspector: ReactNode;
  /**
   * Content for the bottom panel (e.g. navigator view).
   * Rendered in the collapsible bottom strip below the workspace.
   */
  bottomPanel?: ReactNode;
}>;

export function LayoutShell({
  title,
  sessionId,
  layout,
  toolbar,
  nav,
  inspector,
  bottomPanel,
  children,
}: LayoutShellProps) {
  const {
    sidebarWidth,
    sidebarCollapsed,
    inspectorWidth,
    inspectorCollapsed,
    bottomPanelHeight,
    bottomPanelCollapsed,
    setSidebarWidth,
    toggleSidebar,
    setInspectorWidth,
    toggleInspector,
    setBottomPanelHeight,
    toggleBottomPanel,
  } = useLayoutStore();

  // Register keyboard shortcuts
  useLayoutShortcuts();

  // Track the width at drag start so delta is applied from the starting value
  const sidebarStartRef = useRef(sidebarWidth);
  const inspectorStartRef = useRef(inspectorWidth);
  const bottomStartRef = useRef(bottomPanelHeight);

  const handleSidebarResize = useCallback(
    (delta: number) => {
      if (Math.abs(delta) <= 1) {
        sidebarStartRef.current = useLayoutStore.getState().sidebarWidth;
      }
      setSidebarWidth(sidebarStartRef.current + delta);
    },
    [setSidebarWidth],
  );

  const handleInspectorResize = useCallback(
    (delta: number) => {
      if (Math.abs(delta) <= 1) {
        inspectorStartRef.current = useLayoutStore.getState().inspectorWidth;
      }
      // Inspector drags left to grow, so negate delta
      setInspectorWidth(inspectorStartRef.current - delta);
    },
    [setInspectorWidth],
  );

  const handleBottomResize = useCallback(
    (delta: number) => {
      if (Math.abs(delta) <= 1) {
        bottomStartRef.current = useLayoutStore.getState().bottomPanelHeight;
      }
      // Dragging up grows the panel, so negate delta
      setBottomPanelHeight(bottomStartRef.current - delta);
    },
    [setBottomPanelHeight],
  );

  const TAB_BAR_WIDTH = 36;
  const effectiveSidebarWidth = sidebarCollapsed ? TAB_BAR_WIDTH : TAB_BAR_WIDTH + sidebarWidth;
  const effectiveInspectorWidth = inspectorCollapsed ? 0 : inspectorWidth;
  const effectiveBottomHeight = bottomPanelCollapsed ? 0 : bottomPanelHeight;

  return (
    <div
      className="app-shell"
      style={{
        gridTemplateRows: `36px 1fr ${effectiveBottomHeight}px`,
      }}
    >
      <header className="topbar">
        <button
          className="collapse-toggle"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={`Toggle sidebar (Ctrl+B)`}
          type="button"
        >
          {sidebarCollapsed ? "\u203A" : "\u2039"}
        </button>
        <span className="topbar-title">{title}</span>
        <div className="topbar-actions">
          <LayoutPresetPicker />
          <span className="topbar-chip muted">{sessionId.slice(0, 8)}</span>
          <button
            className="collapse-toggle"
            onClick={toggleBottomPanel}
            aria-label={bottomPanelCollapsed ? "Show bottom panel" : "Hide bottom panel"}
            title={`Toggle bottom panel (Ctrl+J)`}
            type="button"
          >
            {bottomPanelCollapsed ? "\u25BD" : "\u25B3"}
          </button>
          {toolbar}
          <button
            className="collapse-toggle"
            onClick={toggleInspector}
            aria-label={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
            title={`Toggle inspector (Ctrl+Shift+B)`}
            type="button"
          >
            {inspectorCollapsed ? "\u2039" : "\u203A"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside
          className="sidebar-col"
          style={{
            width: effectiveSidebarWidth,
            minWidth: effectiveSidebarWidth,
          }}
        >
          {nav}
        </aside>

        {!sidebarCollapsed && (
          <ResizeHandle direction="vertical" onResize={handleSidebarResize} />
        )}

        <main className="main-col">{children}</main>

        {!inspectorCollapsed && (
          <ResizeHandle direction="vertical" onResize={handleInspectorResize} />
        )}

        <section
          className="details-col"
          style={{
            width: effectiveInspectorWidth,
            minWidth: effectiveInspectorWidth,
            visibility: inspectorCollapsed ? "hidden" : undefined,
          }}
        >
          {inspector}
        </section>
      </div>

      {!bottomPanelCollapsed && (
        <ResizeHandle direction="horizontal" onResize={handleBottomResize} />
      )}
      <div
        className="bottom-panel"
        style={{
          height: effectiveBottomHeight,
          visibility: bottomPanelCollapsed ? "hidden" : undefined,
        }}
      >
        {bottomPanel}
      </div>
    </div>
  );
}
