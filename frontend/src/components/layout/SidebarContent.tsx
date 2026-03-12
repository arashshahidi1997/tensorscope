import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { SidebarTabId } from "../../store/layoutStore";
import { useLayoutStore } from "../../store/layoutStore";
import { DAGGraphView } from "./DAGGraphView";
import { PipelineTabContent } from "./PipelineTabContent";
import { TensorBrowserTab } from "./TensorBrowserTab";

type SidebarContentProps = {
  /** Content for the Explore tab */
  exploreContent: ReactNode;
  /** Content for the Events tab */
  eventsContent: ReactNode;
};

/**
 * Routes to the active sidebar tab's content.
 * Explore and Events tabs receive their content as props (they need external data).
 * Graph, Tensors, and Pipeline show placeholder labels.
 */
export function SidebarContent({ exploreContent, eventsContent }: SidebarContentProps) {
  const { activeSidebarTab, sidebarCollapsed } = useLayoutStore();
  const [dagFullscreen, setDagFullscreen] = useState(false);

  const openFullscreen = useCallback(() => setDagFullscreen(true), []);
  const closeFullscreen = useCallback(() => setDagFullscreen(false), []);

  // Escape key closes fullscreen
  useEffect(() => {
    if (!dagFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDagFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dagFullscreen]);

  const graphTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="icon-button"
          onClick={openFullscreen}
          title="Open fullscreen DAG editor"
          aria-label="Open fullscreen DAG editor"
        >
          {"\u26F6"}
        </button>
      </div>
      <DAGGraphView />
    </div>
  );

  return (
    <>
      <div
        className="sidebar-tab-content"
        style={{ display: sidebarCollapsed ? "none" : undefined }}
      >
        {renderTab("explore", activeSidebarTab, exploreContent)}
        {renderTab("graph", activeSidebarTab, graphTab)}
        {renderTab("tensors", activeSidebarTab, <TensorBrowserTab />)}
        {renderTab("events", activeSidebarTab, eventsContent)}
        {renderTab("pipeline", activeSidebarTab, <PipelineTabContent />)}
      </div>

      {dagFullscreen && (
        <div className="dag-fullscreen-overlay" onClick={closeFullscreen}>
          <div
            style={{ width: "100%", height: "100%", position: "relative" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dag-fullscreen-close"
              onClick={closeFullscreen}
              aria-label="Close fullscreen DAG"
            >
              x
            </button>
            <DAGGraphView isFullscreen />
          </div>
        </div>
      )}
    </>
  );
}

function renderTab(tabId: SidebarTabId, activeTab: SidebarTabId, content: ReactNode) {
  return (
    <div
      style={{ display: activeTab === tabId ? "contents" : "none" }}
      data-sidebar-tab={tabId}
    >
      {content}
    </div>
  );
}
