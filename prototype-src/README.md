# Prototype source (extracted from `Health Dashboard.html`)

Readable React/JSX modules extracted from the Claude Design bundle (the bundle itself is a throwaway visual mockup with **synthetic** data). These are the design source of truth for the Slice 7 build — port the components, chart primitives, design tokens, and layout from here; replace the mock data layer (`02-data-layer.jsx`) with real queries against Supabase.

Modules:
- `01-icons.jsx` — inline lucide-style SVG icon set
- `02-data-layer.jsx` — SYNTHETIC seeded data + the daily-rollup shape + the Cardiac Readiness formula (weights). The rollup shape is the target the real aggregation layer must produce.
- `03-components.jsx` — Card, PanelHeader, KpiCard, MedChecklist, Timeline, SourceBadge, etc.
- `04-app.jsx` — App shell: header (greeting, recovery-day counter, 7/30/90 range, theme toggle), Dashboard tab panels, status thresholds
- `05-connections.jsx` — Correlations tab (Slice 7.2): metric catalog, presets, Correlation Explorer, pearson r, insight sentences
- `06-charts.jsx` — custom SVG chart primitives: Sparkline, TrendChart (bands+hover), CGMChart, Donut, StackedBars, ScatterChart, DualAxisChart, pearson
