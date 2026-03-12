/**
 * ViewPanel — thin chrome wrapper around each view in the grid.
 *
 * Provides a 24px header with view label, maximize toggle, and close button.
 * The view component is rendered as children and is not modified.
 */
import type { ReactNode } from "react";

type ViewPanelProps = {
  viewId: string;
  label: string;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function ViewPanel({
  label,
  isMaximized,
  onToggleMaximize,
  onClose,
  children,
}: ViewPanelProps) {
  return (
    <div className="view-panel">
      <div className="view-panel-header">
        <span className="panel-title">{label}</span>
        <button
          type="button"
          className="view-panel-btn"
          onClick={onToggleMaximize}
          aria-label={isMaximized ? "Restore view" : "Maximize view"}
          title={isMaximized ? "Restore (Ctrl+Shift+M)" : "Maximize (Ctrl+Shift+M)"}
        >
          {isMaximized ? "\u229F" : "\u2922"}
        </button>
        <button
          type="button"
          className="view-panel-btn"
          onClick={onClose}
          aria-label="Close view"
          title="Close"
        >
          \u00D7
        </button>
      </div>
      <div className="view-panel-body">
        {children}
      </div>
    </div>
  );
}
