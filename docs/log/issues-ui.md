# UI Issues & Feature Requests (2026-03-12)

Organized from voice notes. PSD = Power Spectral Density throughout.

---

## Bugs

### B1. Y-axis zoom resets immediately

The timeseries Y-axis can be scrolled momentarily, but as soon as the signal reaches the boundary of the view box, the scale snaps back. Root cause: uPlot auto-ranges Y on every redraw (no `range` lock on the Y axis), and the chart is destroyed/recreated when data changes (`[times, series]` dep), resetting `yGainRef` to 1.

### B2. View toggle instability — views shift and stretch

- Toggling timeseries off causes spatial map to go fullscreen (unwanted).
- Toggling timeseries back on causes spatial map to stretch vertically (cells grow, requires scrolling).
- After toggling both off and back on, timeseries takes full width and spatial map gets pushed/compressed.
- **Desired**: stable positions — each view stays in its assigned region regardless of other views being toggled on/off.

### B3. Timeseries goes blank after layout changes

After minor changes (e.g. toggling a sibling view), the timeseries panel goes blank. Requires double-clicking the panel to see the signal again. Likely related to chart recreation + container size being 0 during layout transition.

### B4. Propagation frame is oversized

The propagation frame view takes a full grid cell (potentially fullscreen when alone). It should be constrained to spatial-map dimensions and sit beside other views, not dominate the layout.

---

## Feature Requests

### F1. Two distinct Y-axis interaction modes

**Mode A — Y-scale zoom (free zoom):** Expand or contract the Y-axis range. Signals may clip beyond boundaries. This is standard zoom-at-point behavior. Allows zooming into a specific amplitude range.

**Mode B — Amplitude gain (uniform scaling):** Increase the visual amplitude of all signals without changing the Y-axis scale or the vertical gaps between channels. Channel positions remain stable; only the waveform "height" grows or shrinks. Like a gain knob on an oscilloscope.

These should be accessible as two separate interaction modes (e.g. different modifier keys, or a toggle in ChartToolbar), not mixed into a single scroll behavior.

### F2. Time scale selector

Start the timeseries view zoomed in (e.g. 1 second of data, not the entire recording). Provide a neuroscope-style time scale selector with presets: 10ms, 50ms, 100ms, 500ms, 1s, 5s, 10s. Changing the scale re-centers around the current time cursor.

### F3. Relative time labels (drop datetime)

Remove absolute datetime (e.g. "11:00 AM") from the X-axis. Show relative time in seconds from file start. Files are typically ~2 hours of neuroelectrophysiology; absolute timestamps are meaningless. Fine-resolution labels needed (e.g. "42.350 s").

### F4. Persistent time cursor line on timeseries

Show the currently selected time as a visible vertical bar/line on the timeseries view at all times (not just on hover). This serves as a spatial anchor for the user's position in the recording.

### F5. PSD panel — three linked sub-views

For the currently visible time window, compute and display PSD in three linked panels:

**F5a. Channel × Frequency heatmap:**
- X-axis: channels (stack AP and ML into a linear channel index)
- Y-axis: frequency (0 to configurable upper bound, default 100 Hz)
- Color: PSD power
- Shared Y-axis with F5b

**F5b. Average PSD curve:**
- Y-axis: frequency (shared with F5a)
- X-axis: PSD power amplitude
- Line: mean PSD averaged over all channels
- Shading: ±1 standard deviation
- Orientation: vertical frequency axis (rotated plot)

**F5c. Spatial PSD map:**
- At the currently selected frequency and time window, show a spatial (AP × ML) heatmap of PSD power
- Same layout as the existing spatial_map view
- Stable position, sits to the right of the heatmap/curve panels

**PSD settings panel:** frequency range (min/max), window function, number of segments (Welch params). Collapsible settings bar above or within the PSD region.

### F6. Layout: stable view positions

Views should have fixed "slots" in the workspace. Toggling a view on/off should show/hide it in its slot without causing other views to resize or reflow. The user controls fullscreen via individual maximize toggles.

**Proposed layout:**
```
+-----------------------------+---------------+
| Timeseries (top-left)       | Spatial map   |
|                             | (top-right)   |
+-----------------------------+---------------+
| PSD heatmap | PSD curve     | PSD spatial   |
| (bot-left)  | (bot-center)  | (bot-right)   |
+-----------------------------+---------------+
```

### F7. Sidebar cleanup

- **Drop** the Layout panel (server-side layout presets are non-functional / redundant with client-side presets from M7).
- **Selection widgets**: move to a less prominent position (e.g. bottom of sidebar, collapsed by default).
- **Processing panel**: make it a larger, vertically collapsible section under a "Processing" header bar.

---

## Priority Order

1. **B2 + F6** — Stable view positions (foundational, affects everything)
2. **B1 + F1** — Y-axis zoom fix + two interaction modes
3. **B3** — Timeseries blank after layout changes
4. **F3** — Relative time labels
5. **F4** — Persistent time cursor line
6. **F2** — Time scale selector
7. **F7** — Sidebar cleanup
8. **B4** — Propagation frame sizing
9. **F5** — PSD panel (largest feature, depends on stable layout)
