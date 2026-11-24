# O-Detect-Reader-PLUS (Aperture Tolerance Analyzer)

Modular, accessible HTML5 edition of the **Aperture Tolerance Analyzer** (AF Engineering Tools).

## What's New in PLUS
- **Modular Architecture**: Separated into `index.html`, `styles.css`, and deferred `app.js`.
- **HTML5 & Accessibility (WCAG 2.2 AA)**: Deferred CDN scripts with `crossorigin="anonymous"`, keyboard-accessible file input (`sr-only` + `peer-focus-visible`), `focus-visible` rings, `aria-hidden="true"` on decorative icons, `aria-live="polite"` status regions, explicit `type="button"` attributes, and standard Firefox scrollbar styling.
- **Inline Editable Chart Titles**: Click any default or custom chart title to rename it live; edited titles propagate to PNG exports, PDF reports, and folder exports.
- **Configuration Persistence**: Exported `.json` configuration files save and restore all edited chart titles and the selected export chart font size.
- **2D Marker Size Fidelity**: Exported PNG and PDF 2D charts respect the exact `2D Pts` marker size input.
- **3:1 Export Aspect Ratio**: All 2D exported charts render at a 3:1 aspect ratio (`1800 x 600` px for PNG, `2100 x 700` px for PDF).
- **Selectable Export Font Size**: Configure the base export chart font size (`10-48 px`) from the **3. Export** panel.

## Deployment
Upload `index.html`, `styles.css`, `app.js`, and `README.md` to the root of `mfo78/O-Detect-Reader-PLUS` and enable GitHub Pages on the `main` branch.
