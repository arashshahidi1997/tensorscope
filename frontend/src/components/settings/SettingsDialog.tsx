import type { ThemeId } from "../../store/appStore";

const THEMES: Array<{
  id: ThemeId;
  label: string;
  description: string;
}> = [
  {
    id: "plotly-dark",
    label: "Plotly Dark",
    description: "Deep slate surfaces with a restrained blue accent.",
  },
  {
    id: "bokeh-dark",
    label: "Bokeh Dark",
    description: "Softer scientific dark chrome with lighter panels.",
  },
  {
    id: "panel-light",
    label: "Panel Light",
    description: "Bright notebook-style layout for longer analysis sessions.",
  },
];

type SettingsDialogProps = {
  open: boolean;
  theme: ThemeId;
  onClose: () => void;
  onThemeChange: (theme: ThemeId) => void;
};

export function SettingsDialog({ open, theme, onClose, onThemeChange }: SettingsDialogProps) {
  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose} role="presentation">
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="settings-header">
          <div>
            <h2 className="settings-title" id="settings-title">Settings</h2>
            <p className="settings-subtitle">Tune the workspace appearance.</p>
          </div>
          <button
            aria-label="Close settings"
            className="settings-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="settings-body">
          <nav aria-label="Settings sections" className="settings-tabs">
            <button
              aria-current="page"
              className="settings-tab active"
              type="button"
            >
              Theme
            </button>
          </nav>

          <div className="settings-panel">
            <div className="settings-panel-head">
              <h3>Theme</h3>
              <p>Choose the visual tone for controls, surfaces, and chart chrome.</p>
            </div>

            <div className="theme-grid">
              {THEMES.map((option) => (
                <button
                  className={`theme-card${theme === option.id ? " active" : ""}`}
                  key={option.id}
                  onClick={() => onThemeChange(option.id)}
                  type="button"
                >
                  <div className="theme-card-swatch" data-theme-preview={option.id}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="theme-card-copy">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
