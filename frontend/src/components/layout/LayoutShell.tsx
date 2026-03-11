import type { PropsWithChildren, ReactNode } from "react";
import type { LayoutDTO } from "../../api/types";

type LayoutShellProps = PropsWithChildren<{
  title: string;
  sessionId: string;
  layout: LayoutDTO;
  sidebar: ReactNode;
  details: ReactNode;
}>;

export function LayoutShell({ title, sessionId, layout, sidebar, details, children }: LayoutShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-title">{title}</span>
        <span className="topbar-chip">{layout.current_preset}</span>
        <span className="topbar-chip muted">{sessionId.slice(0, 8)}</span>
      </header>
      <div className="workspace">
        <aside className="sidebar-col">{sidebar}</aside>
        <main className="main-col">{children}</main>
        <section className="details-col">{details}</section>
      </div>
    </div>
  );
}
