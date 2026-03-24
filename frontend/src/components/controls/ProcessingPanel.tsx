import { useEffect, useRef, useState } from "react";
import type { ProcessingParamsDTO } from "../../api/types";
import { useActivityStore } from "../../store/activityStore";

type Props = {
  params: ProcessingParamsDTO;
  onApply: (params: ProcessingParamsDTO) => void;
  isPending?: boolean;
  tensorName?: string;
  onClose?: () => void;
};

const DEFAULT: ProcessingParamsDTO = {
  cmr: false,
  bandpass_lo: null,
  bandpass_hi: null,
  bandpass_order: 4,
  notch_freq: null,
  notch_harmonics: 3,
  notch_freqs_list: null,
  notch_q: 30,
  spatial_median: false,
  spatial_median_size: 3,
  zscore: false,
  zscore_robust: false,
};

export function ProcessingPanel({ params, onApply, isPending, tensorName, onClose }: Props) {
  const [draft, setDraft] = useState<ProcessingParamsDTO>(params);
  const [notchMode, setNotchMode] = useState<"harmonics" | "list">(
    draft.notch_freqs_list ? "list" : "harmonics",
  );
  const [notchListText, setNotchListText] = useState<string>(
    draft.notch_freqs_list ? draft.notch_freqs_list.join(", ") : "",
  );
  const [live, setLive] = useState(false);
  const onApplyRef = useRef(onApply);
  useEffect(() => { onApplyRef.current = onApply; });

  const addActivity = useActivityStore((s) => s.addActivity);
  const updateActivity = useActivityStore((s) => s.updateActivity);

  function handleApply(params: ProcessingParamsDTO) {
    const actId = crypto.randomUUID();
    const startedAt = Date.now();
    addActivity({ id: actId, label: "Processing: apply pipeline", status: "running", startedAt });
    try {
      onApply(params);
      updateActivity(actId, { status: "done", endedAt: Date.now(), elapsed: Date.now() - startedAt });
    } catch (e) {
      updateActivity(actId, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Reactive mode: debounce Apply calls whenever draft changes
  useEffect(() => {
    if (!live) return;
    const final = buildFinal();
    const id = setTimeout(() => onApplyRef.current(final), 400);
    return () => clearTimeout(id);
    // buildFinal reads draft+notchMode which are in the dep array via draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, draft, notchMode]);

  function patch(update: Partial<ProcessingParamsDTO>) {
    setDraft((p) => ({ ...p, ...update }));
  }

  function numOrNull(v: string): number | null {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function handleNotchModeChange(mode: "harmonics" | "list") {
    setNotchMode(mode);
    if (mode === "harmonics") {
      patch({ notch_freqs_list: null });
    } else {
      const parsed = notchListText
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n));
      patch({ notch_freqs_list: parsed.length ? parsed : null });
    }
  }

  function handleNotchListBlur() {
    const parsed = notchListText
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
    patch({ notch_freqs_list: parsed.length ? parsed : null });
  }

  function buildFinal(): ProcessingParamsDTO {
    if (notchMode === "list") {
      return { ...draft, notch_freq: null };
    }
    return { ...draft, notch_freqs_list: null };
  }

  return (
    <div
      className="panel"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !isPending && !live) {
          e.preventDefault();
          handleApply(buildFinal());
        }
        if (e.key === "Escape") {
          onClose?.();
        }
      }}
    >
      <div className="panel-title">
        Processing{tensorName ? <span className="panel-title-scope"> — {tensorName}</span> : null}
      </div>

      {/* CMR */}
      <label className="check-row">
        <input type="checkbox" checked={draft.cmr} onChange={(e) => patch({ cmr: e.target.checked })} />
        <span>CMR</span>
      </label>

      {/* Bandpass */}
      <div className="param-section">
        <span className="param-label">Bandpass (Hz)</span>
        <div className="param-row">
          <input
            className="num-input"
            type="number"
            placeholder="lo"
            value={draft.bandpass_lo ?? ""}
            min={0.1}
            step={1}
            onChange={(e) => patch({ bandpass_lo: numOrNull(e.target.value) })}
          />
          <span className="muted">–</span>
          <input
            className="num-input"
            type="number"
            placeholder="hi"
            value={draft.bandpass_hi ?? ""}
            min={0.1}
            step={1}
            onChange={(e) => patch({ bandpass_hi: numOrNull(e.target.value) })}
          />
          <span className="muted">ord</span>
          <input
            className="num-input small"
            type="number"
            value={draft.bandpass_order}
            min={1}
            max={8}
            step={1}
            onChange={(e) => patch({ bandpass_order: parseInt(e.target.value, 10) || 4 })}
          />
        </div>
      </div>

      {/* Notch */}
      <div className="param-section">
        <div className="param-row">
          <span className="param-label" style={{ margin: 0 }}>Notch</span>
          <div className="pill-row" style={{ marginLeft: "auto" }}>
            <button
              type="button"
              className={notchMode === "harmonics" ? "pill active" : "pill"}
              onClick={() => handleNotchModeChange("harmonics")}
            >harm</button>
            <button
              type="button"
              className={notchMode === "list" ? "pill active" : "pill"}
              onClick={() => handleNotchModeChange("list")}
            >list</button>
          </div>
        </div>

        {notchMode === "harmonics" ? (
          <div className="param-row">
            <input
              className="num-input"
              type="number"
              placeholder="fund Hz"
              value={draft.notch_freq ?? ""}
              min={0.1}
              step={1}
              onChange={(e) => patch({ notch_freq: numOrNull(e.target.value) })}
            />
            <span className="muted">×</span>
            <input
              className="num-input small"
              type="number"
              value={draft.notch_harmonics}
              min={1}
              max={10}
              step={1}
              onChange={(e) => patch({ notch_harmonics: parseInt(e.target.value, 10) || 1 })}
            />
          </div>
        ) : (
          <input
            className="num-input"
            style={{ width: "100%" }}
            type="text"
            placeholder="60, 120, 180"
            value={notchListText}
            onChange={(e) => setNotchListText(e.target.value)}
            onBlur={handleNotchListBlur}
          />
        )}

        <div className="param-row">
          <span className="muted">Q</span>
          <input
            className="num-input small"
            type="number"
            value={draft.notch_q}
            min={1}
            step={5}
            onChange={(e) => patch({ notch_q: parseFloat(e.target.value) || 30 })}
          />
        </div>
      </div>

      {/* Spatial median */}
      <div className="param-section">
        <label className="check-row" style={{ marginBottom: 3 }}>
          <input
            type="checkbox"
            checked={draft.spatial_median}
            onChange={(e) => patch({ spatial_median: e.target.checked })}
          />
          <span>Spatial median</span>
        </label>
        {draft.spatial_median && (
          <div className="param-row">
            <span className="muted">kernel</span>
            <input
              className="num-input small"
              type="number"
              value={draft.spatial_median_size}
              min={1}
              max={15}
              step={2}
              onChange={(e) => patch({ spatial_median_size: parseInt(e.target.value, 10) || 3 })}
            />
          </div>
        )}
      </div>

      {/* Z-score */}
      <label className="check-row">
        <input type="checkbox" checked={draft.zscore} onChange={(e) => patch({ zscore: e.target.checked })} />
        <span>Z-score</span>
      </label>
      {draft.zscore && (
        <label className="check-row indent">
          <input
            type="checkbox"
            checked={draft.zscore_robust}
            onChange={(e) => patch({ zscore_robust: e.target.checked })}
          />
          <span className="muted">robust (MAD)</span>
        </label>
      )}

      <div className="proc-actions">
        <button
          type="button"
          className="action-button"
          onClick={() => handleApply(buildFinal())}
          disabled={isPending || live}
          title={live ? "Disable Live mode to use Apply" : undefined}
        >
          {isPending ? "Applying…" : "Apply"}
        </button>
        <button
          type="button"
          className={`action-button${live ? " active" : ""}`}
          onClick={() => setLive((v) => !v)}
          title="Apply changes immediately as you type"
        >
          Live
        </button>
        <button
          type="button"
          className="action-button secondary"
          onClick={() => {
            setDraft(DEFAULT);
            setNotchMode("harmonics");
            setNotchListText("");
            handleApply(DEFAULT);
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
