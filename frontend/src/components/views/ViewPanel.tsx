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
  /** True while this view's slice is (re)fetching — shows a loading indicator. */
  isFetching?: boolean;
  /** True if the latest fetch for this view errored. The panel still paints
   *  the previous successful slice (`keepPreviousData`), so we surface an
   *  "error" badge so the user knows the data on screen is stale and the
   *  last attempt to refresh failed. (refactor-plan N2.) */
  isError?: boolean;
  /** True if the panel is currently painting previous-window placeholder
   *  data because the in-flight fetch hasn't resolved. Distinct from
   *  isFetching: distinguishes "loading initial data" from "loading new
   *  window, showing previous". */
  isStale?: boolean;
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
  isFetching = false,
  isError = false,
  isStale = false,
  children,
}: ViewPanelProps) {
  return (
    <div className="view-panel">
      <div className="view-panel-header">
        <span className="panel-title">{label}</span>
        {isError && (
          <span
            className="panel-badge panel-badge--error"
            role="status"
            aria-label="Last fetch failed; showing previous data"
            title="Last fetch failed — panel is showing the previously loaded window."
          >
            error
          </span>
        )}
        {!isError && isStale && (
          <span
            className="panel-badge panel-badge--stale"
            role="status"
            aria-label="Showing previous-window data while loading"
            title="Showing the previously loaded window while the new fetch is in flight."
          >
            stale
          </span>
        )}
        {isFetching && (
          <span
            className="panel-loading"
            role="status"
            aria-label="Loading"
            title="Loading…"
          >
            <span className="spinner" aria-hidden="true" /> loading…
          </span>
        )}
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
