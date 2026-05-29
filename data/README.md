# Repository Data Files

Put shared dashboard Excel files in this folder, then list them in `manifest.json`.

Example:

```json
{
  "files": [
    {
      "path": "data/weekly-style-sales-2026-wk-15.xlsx",
      "name": "2026 Week 15"
    }
  ]
}
```

Only files listed in `manifest.json` are loaded by the dashboard.
