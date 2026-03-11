import type { LayoutDTO } from "../../api/types";

type Props = { layout: LayoutDTO; onPresetChange: (preset: string) => void };

export function LayoutPanel({ layout, onPresetChange }: Props) {
  return (
    <div className="panel">
      <div className="panel-title">Layout</div>
      <div className="pill-row">
        {layout.available_presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={preset === layout.current_preset ? "pill active" : "pill"}
            onClick={() => onPresetChange(preset)}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
