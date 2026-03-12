import type { ReactNode } from "react";
import type { SidebarTabId } from "../../store/layoutStore";
import { useLayoutStore } from "../../store/layoutStore";
import { PlaceholderTab } from "./PlaceholderTab";

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

  return (
    <div
      className="sidebar-tab-content"
      style={{ display: sidebarCollapsed ? "none" : undefined }}
    >
      {renderTab("explore", activeSidebarTab, exploreContent)}
      {renderTab("graph", activeSidebarTab, <PlaceholderTab label="Transform DAG inspector" />)}
      {renderTab("tensors", activeSidebarTab, <PlaceholderTab label="Tensor browser" />)}
      {renderTab("events", activeSidebarTab, eventsContent)}
      {renderTab("pipeline", activeSidebarTab, <PlaceholderTab label="Pipeline export" />)}
    </div>
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
