# Product Performance Dashboard

A static product performance dashboard for weekly sales workbooks with a `Detail` tab. It can be hosted directly on GitHub Pages and runs entirely in the browser.

## What It Does

- Upload one or more `.xlsx` or `.xlsm` sales files.
- References Gotham Ultra for primary headings and Gotham Bold for secondary UI text when those fonts are installed locally.
- Reads the `Detail` worksheet and appends new rows to saved browser data.
- De-duplicates repeat uploads by file hash and row key.
- Filters and pivots by:
  - Shipping Province
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
- Shows a full product-results panel with net sales, net units sold, and percent of sales for the current result set.
- Exports the current pivot table to CSV.
- Exports and imports the saved dashboard dataset as JSON.

## Expected Workbook Shape

The app expects a worksheet named `Detail` with these headers:

`Date`, `Net Sales`, `Net Quantity`, `Shipping Province`, `Status`, `Group`, `Department`, `Color`, `Brand`, `Class`, `Sub-Class`, `Collection`, `Customer Type`

The sample file also includes `SKU`, `Product Title`, and `Order ID`; the dashboard uses those fields for row identity and order counts when present.

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
2. Upload `index.html`, `styles.css`, `app.js`, `.nojekyll`, and this `README.md`.
3. In GitHub, go to `Settings` > `Pages`.
4. Set the source to your main branch and root folder.
5. Open the published Pages URL.

## Data Storage

Uploaded sales rows are saved in the browser's IndexedDB storage for that GitHub Pages URL. To move the saved dataset to another browser or computer, use `Export Data`, then `Import Data` on the other browser.

The app does not send workbook data to a server. For a shared multi-user database or automatic server-side imports from a repository folder, add a backend or GitHub Action workflow later.
