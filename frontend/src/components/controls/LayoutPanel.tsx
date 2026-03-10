import type { LayoutDTO } from "../../api/types";

type LayoutPanelProps = {
  layout: LayoutDTO;
  onPresetChange: (preset: string) => void;
};

export function LayoutPanel({ layout, onPresetChange }: LayoutPanelProps) {
  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>Layout Presets</h2>
        <p>Bound to `PUT /api/v1/layout`.</p>
      </div>

      <div className="pill-list">
        {layout.available_presets.map((preset) => {
          const active = preset === layout.current_preset;
          return (
            <button
              className={active ? "pill active" : "pill"}
              key={preset}
              onClick={() => onPresetChange(preset)}
              type="button"
            >
              {preset}
            </button>
          );
        })}
      </div>
    </div>
  );
}
