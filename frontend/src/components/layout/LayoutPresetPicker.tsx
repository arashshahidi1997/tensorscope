import { useCallback, useEffect, useRef, useState } from "react";
import { useLayoutStore } from "../../store/layoutStore";
import { LAYOUT_PRESETS } from "./layoutPresets";

export function LayoutPresetPicker() {
  const { activePreset, applyPreset } = useLayoutStore();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeLabel =
    LAYOUT_PRESETS.find((p) => p.id === activePreset)?.label ?? "Custom";

  const handleSelect = useCallback(
    (presetId: string) => {
      const preset = LAYOUT_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        applyPreset(preset.layout, preset.id);
      }
      setOpen(false);
    },
    [applyPreset],
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="topbar-chip"
        onClick={() => setOpen((o) => !o)}
        title="Layout preset"
        style={{ cursor: "pointer", border: "none", background: "transparent", font: "inherit" }}
      >
        {activeLabel}
      </button>
      {open && (
        <div className="preset-dropdown">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-option${preset.id === activePreset ? " active" : ""}`}
              onClick={() => handleSelect(preset.id)}
              title={preset.description}
            >
              <span className="preset-option-label">{preset.label}</span>
              <span className="preset-option-desc">{preset.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
