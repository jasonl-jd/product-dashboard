# Repository Data Files

Put shared dashboard CSV files in this folder, then list them in `manifest.json`.

Each CSV should be exported from the source workbook's sales sheet. The source workbook tab can match the file name; the dashboard reads the CSV headers and does not need a worksheet tab name.

Example:

```json
{
  "files": [
    {
      "path": "data/weekly-style-sales-2026-wk-15.csv",
      "name": "2026 Week 15"
    }
  ]
}
```

Only files listed in `manifest.json` are loaded by the dashboard. Every listed file must exist in this folder before pushing the repository.
