# TWINFORGE — Process Lab design context

The main page is a civil process experiment: two comparable tanks, measurable predictions and bounded control. The historical physics workbench and camera scanner remain separate entries.

The current tokens come from `web/process/lab.css`: dark background `#0e1013`, panels `#16191e`, text `#edece8`, orange `#ff7a32` for action/forecast, cyan `#52cddd` for the controlled tank, and a neutral reference. Fonts use native system and monospace stacks.

Four 21st previews and their code informed the implementation: Dashboard Sidebar 14941, Segmented Tabs 26923, Progress Metric Card 15024 and Vertical Descriptive Stepper 29866. Their URLs, cache hashes and adaptation notes are in `sources.json`. Patterns were adapted to native HTML/CSS; no React component or sample metrics were installed.

Controls retain 44px targets and visible focus. Metrics come from the engine. Synthetic scope, known-family calibration, forecast assumptions and intervention flags remain visible. Recorded Meta responses remain distinct from new calls and from local fitting. Mobile camera processing stays on the device and starts only after explicit user action.

Machine-readable tokens, constraints and decisions are maintained in `design.json`.
