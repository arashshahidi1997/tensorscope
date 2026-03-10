import type { PropsWithChildren, ReactNode } from "react";
import type { LayoutDTO } from "../../api/types";

type LayoutShellProps = PropsWithChildren<{
  title: string;
  sessionId: string;
  layout: LayoutDTO;
  sidebar: ReactNode;
  details: ReactNode;
}>;

export function LayoutShell({
  title,
  sessionId,
  layout,
  sidebar,
  details,
  children,
}: LayoutShellProps) {
  return (
    <div className="app-shell">
      <header className="hero-bar">
        <div>
          <p className="eyebrow">TensorScope Phase 3 Shell</p>
          <h1>{title}</h1>
        </div>
        <div className="hero-meta">
          <span>Session {sessionId.slice(0, 8)}</span>
          <span>Preset {layout.current_preset}</span>
          <span>Theme {layout.theme}</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar-card">{sidebar}</aside>
        <main className="main-column">
          <section className="panel-card layout-card">
            <div className="panel-heading">
              <h2>Layout Map</h2>
              <p>Server-driven grid slots from `/api/v1/layout`.</p>
            </div>
            <div className="slot-grid">
              {Object.entries(layout.grid_assignments).map(([panel, area]) => (
                <article className="slot-chip" key={panel}>
                  <strong>{panel}</strong>
                  <span>{area.join(" / ")}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel-card">{children}</section>
        </main>
        <section className="details-column">{details}</section>
      </div>
    </div>
  );
}
