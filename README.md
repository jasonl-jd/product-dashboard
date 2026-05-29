# Product Performance Dashboard

A static product performance dashboard for weekly sales workbooks with a `Detail` tab. It can be hosted directly on GitHub Pages and runs entirely in the browser.

## What It Does

- Loads shared `.xlsx` or `.xlsm` sales files listed in `data/manifest.json`.
- Uses a black workspace with a yellow `#ffdd00` primary accent.
- References Gotham Ultra for primary headings and Gotham Bold for secondary UI text when those fonts are installed locally.
- Reads each workbook's `Detail` worksheet directly from the GitHub repository.
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
- Shows the top 20 products by region, sortable by net sales or net units sold.
- Shows a full product-results panel with net sales, net units sold, and percent of sales for the current result set.
- Exports the current pivot table to CSV.

## Expected Workbook Shape

The app expects a worksheet named `Detail` with these headers:

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

1. Add the Excel workbook to the `data/` folder.
2. Add an entry for the workbook in `data/manifest.json`.
3. Commit and push the changes to GitHub.
4. Wait for GitHub Pages to redeploy, then use `Refresh Data` in the dashboard.

Example `data/manifest.json`:

```json
{
  "files": [
    {
      "path": "data/weekly-style-sales-2026-wk-15.xlsx",
      "name": "2026 Week 15"
    },
    {
      "path": "data/weekly-style-sales-2026-wk-16.xlsx",
      "name": "2026 Week 16"
    }
  ]
}
```

The static dashboard cannot write uploads back to GitHub by itself; data file management happens through repository commits controlled by the repository owner.
