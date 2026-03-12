import type { SidebarTabId } from "../../store/layoutStore";
import { useLayoutStore } from "../../store/layoutStore";

type TabDef = {
  id: SidebarTabId;
  icon: string;
  label: string;
};

const TABS: TabDef[] = [
  { id: "explore", icon: "\u25CE", label: "Explore" },
  { id: "graph", icon: "\u2442", label: "Graph" },
  { id: "tensors", icon: "\u2B21", label: "Tensors" },
  { id: "events", icon: "\u2691", label: "Events" },
  { id: "pipeline", icon: "\u21F6", label: "Pipeline" },
];

export function SidebarTabBar() {
  const { activeSidebarTab, setActiveSidebarTab } = useLayoutStore();

  return (
    <div className="sidebar-tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`sidebar-tab${activeSidebarTab === tab.id ? " active" : ""}`}
          onClick={() => setActiveSidebarTab(tab.id)}
          title={tab.label}
          aria-label={tab.label}
          type="button"
        >
          {tab.icon}
        </button>
      ))}
    </div>
  );
}
