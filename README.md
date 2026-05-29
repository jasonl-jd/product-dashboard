# Product Performance Dashboard

A static product performance dashboard for weekly sales CSV exports. It can be hosted directly on GitHub Pages and runs entirely in the browser.

## What It Does

- Loads shared `.csv` sales files listed in `data/manifest.json`.
- Uses a black workspace with a yellow `#ffdd00` primary accent.
- References Gotham Ultra for primary headings and Gotham Bold for secondary UI text when those fonts are installed locally.
- Reads each CSV file directly from the GitHub repository.
- De-duplicates repeated rows by row key across repository files.
- Filters and pivots by:
  - Shipping Province
  - Region
  - Status
  - Group
  - Department
  - Color
  - Brand
  - Class
  - Sub-Class
  - Collection
  - Customer Type
- Compares one date period to another.
- Shows net sales, net units, percent of sales, percent of units, comparison sales, and change metrics.
- Shows the top 20 products by region in a separate dashboard tab, sortable by net sales or net units sold.
- Shows a right-side product-results panel with net sales, net units sold, percent of sales, sales dollar change, and sales percent change.
- Exports the current pivot table to CSV.

## Expected CSV Shape

The app expects each CSV to be a flat export with these headers in the first non-empty row:

`Date`, `Net Sales`, `Net Quantity`, `Shipping Province`, `Status`, `Group`, `Department`, `Color`, `Brand`, `Class`, `Sub-Class`, `Collection`, `Customer Type`

The sample file also includes `SKU`, `Product Title`, and `Order ID`; the dashboard uses those fields for row identity and order counts when present.

Regions are derived from `Shipping Province`:

- BC: British Columbia
- ON: Ontario
- Prairies: Alberta, Saskatchewan, Manitoba
- QC + Atlantic: Quebec, Prince Edward Island, Newfoundland and Labrador, Nova Scotia, New Brunswick

## Local Use

From this folder, start any static web server and open the site in a browser. For example:

```powershell
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## GitHub Pages

1. Create a new GitHub repository.
2. Upload `index.html`, `styles.css`, `app.js`, `.nojekyll`, the `data/` folder, and this `README.md`.
3. In GitHub, go to `Settings` > `Pages`.
4. Set the source to your main branch and root folder.
5. Open the published Pages URL.

Use the GitHub Pages URL, not the normal GitHub repository file preview. The Pages URL usually looks like:

```text
https://your-username.github.io/your-repo-name/
```

If the page says `App loading...` and never changes to `Ready`, `app.js` is not being served or was not uploaded. If repository data fails to load, the status bar at the top of the dashboard will show the error.

## Data Storage

Dashboard data is centralized in the GitHub repository. The app loads only the files listed in `data/manifest.json`, so every user who opens the same GitHub Pages URL sees the same dataset.

To add or refresh data:

1. Export the source file's sales sheet as a CSV file. In the source workbook, that sheet can be named to match the file name; the dashboard reads the CSV headers and does not need a worksheet tab name.
2. Add the CSV file to the `data/` folder.
3. Add an entry for the CSV file in `data/manifest.json`.
4. Commit and push the changes to GitHub.
5. Wait for GitHub Pages to redeploy, then use `Refresh Data` in the dashboard.

Example `data/manifest.json`:

```json
{
  "files": [
    {
      "path": "data/weekly-style-sales-2026-wk-15.csv",
      "name": "2026 Week 15"
    },
    {
      "path": "data/weekly-style-sales-2026-wk-16.csv",
      "name": "2026 Week 16"
    }
  ]
}
```

The static dashboard cannot write uploads back to GitHub by itself; data file management happens through repository commits controlled by the repository owner.

Only list CSV files that actually exist in the repository. If a manifest entry points to a missing file, the dashboard will stop and show the missing path so the shared dataset does not load partially by accident.

## Troubleshooting Data Files

If the dashboard says a CSV loaded as HTML, the manifest path is not returning the actual CSV file.

Check these items:

- Use a repository file path such as `data/weekly-style-sales-2026-wk-15.csv`.
- Do not use a GitHub `blob` URL such as `https://github.com/user/repo/blob/main/data/file.csv`.
- File paths are case-sensitive on GitHub Pages.
- Make sure the CSV file is committed to the repository and GitHub Pages has redeployed.
- Do not rename an Excel workbook to `.csv`; export the sales sheet to CSV from Excel or another spreadsheet tool.
- If the file is stored with Git LFS, GitHub Pages may serve a small pointer text file instead of the CSV. In that case, store the actual `.csv` file in the repo without LFS or use a raw downloadable file URL that returns the real CSV text.
