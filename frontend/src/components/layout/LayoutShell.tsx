import type { PropsWithChildren, ReactNode } from "react";
import type { LayoutDTO } from "../../api/types";

type LayoutShellProps = PropsWithChildren<{
  title: string;
  sessionId: string;
  layout: LayoutDTO;
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
}>;

export function LayoutShell({ title, sessionId, layout, nav, inspector, children }: LayoutShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-title">{title}</span>
        <span className="topbar-chip">{layout.current_preset}</span>
        <span className="topbar-chip muted">{sessionId.slice(0, 8)}</span>
      </header>
      <div className="workspace">
        <aside className="sidebar-col">{nav}</aside>
        <main className="main-col">{children}</main>
        <section className="details-col">{inspector}</section>
      </div>
    </div>
  );
}
