/**
 * ViewPanel — thin chrome wrapper around each view in the grid.
 *
 * Provides a 24px header with view label, per-panel tensor selector,
 * maximize toggle, and close button.
 * The view component is rendered as children and is not modified.
 */
import type { ReactNode } from "react";

type ViewPanelProps = {
  viewId: string;
  label: string;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  /** Current tensor name displayed by this panel (override or global). */
  tensorName: string;
  /** Whether this panel has a per-panel tensor override (pinned). */
  isPinned: boolean;
  /** All available tensor names for the dropdown. */
  tensorNames: string[];
  /** Set a per-panel tensor override. */
  onSetTensor: (tensorName: string) => void;
  /** Clear the per-panel tensor override (revert to global). */
  onClearTensor: () => void;
  children: ReactNode;
};

export function ViewPanel({
  label,
  isMaximized,
  onToggleMaximize,
  onClose,
  tensorName,
  isPinned,
  tensorNames,
  onSetTensor,
  onClearTensor,
  children,
}: ViewPanelProps) {
  return (
    <div className="view-panel">
      <div className="view-panel-header">
        <span className="panel-title">{label}</span>
        {tensorNames.length > 1 && (
          <div className="panel-tensor-selector">
            {isPinned && (
              <button
                type="button"
                className="panel-tensor-pin"
                onClick={onClearTensor}
                aria-label="Unpin tensor (use global)"
                title="Pinned — click to use global tensor"
              />
            )}
            <select
              className="panel-tensor-dropdown"
              value={tensorName}
              onChange={(e) => onSetTensor(e.target.value)}
              title={`Tensor: ${tensorName}`}
            >
              {tensorNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
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
          {"\u00D7"}
        </button>
      </div>
      <div className="view-panel-body">
        {children}
      </div>
    </div>
  );
}
