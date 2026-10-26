"use strict";

const MarkdownChecker = (() => {
  const STORAGE_KEY = "product-dashboard:markdown-lists-v1";
  const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });
  const count = new Intl.NumberFormat("en-CA");
  let root, lists = [], pending = [], result = null, source = null, run = 0, sort = { key: "currentSales", direction: -1 };
  const $ = id => root.querySelector(`#md-${id}`);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const currency = value => value === null ? "n/a" : money.format(value);
  const units = value => value === null ? "n/a" : count.format(value);
  const pct = value => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const selected = () => lists.find(list => list.id === $("list").value);
  const option = (value, label) => `<option value="${escape(value)}">${escape(label)}</option>`;
  function message(text, error = false) { $("message").textContent = text; $("message").classList.toggle("error", error); }
  function init() {
    root = document.querySelector("#markdown-view");
    if (!root) return;
    root.innerHTML = `
      <div class="md-heading"><div><span class="panel-kicker">Markdown review</span><h2>New &amp; Further</h2></div>
        <label class="button compact md-file-label">Import list<input id="md-upload" class="visually-hidden" type="file" accept=".csv,.xlsx,.xlsb,.xls" multiple></label></div>
      <div id="md-message" class="status-bar" role="status">No markdown lists imported.</div>
      <form id="md-import" class="md-controls" hidden>
        <label>Workbook / sheet<select id="md-pending"></select></label>
        <label>Go-live date<input id="md-launch" type="date" required></label>
        <label id="md-retail-label" class="md-check" hidden><input id="md-retail" type="checkbox">Channel scope confirmed</label>
        <span id="md-preview" class="md-note"></span><button id="md-add" class="button compact" type="submit">Add list</button>
      </form>
      <div class="md-controls"><label class="md-list-label">Markdown list<select id="md-list"><option value="">No lists</option></select></label>
        <button id="md-remove" class="button compact" type="button" disabled>Remove list</button><span class="md-note">Lists saved in this browser</span></div>
      <form id="md-periods" class="md-controls">
        <label>Period<select id="md-mode"><option value="launch">Launch to Saturday</option><option value="seven">First 7 days</option><option value="custom">Custom</option></select></label>
        <label>Current start<input id="md-start" type="date" required></label><label>Current end<input id="md-end" type="date" required></label>
        <label>Before start<input id="md-before-start" type="date" required></label><label>Before end<input id="md-before-end" type="date" required></label>
        <label>Region<select id="md-region"><option value="">All regions</option><option>BC</option><option>ON</option><option>Prairies</option><option>QC + Atlantic</option><option>Other</option><option value="(blank)">Unassigned</option></select></label>
        <label>Brand<select id="md-brand"><option value="">All brands</option></select></label>
        <label>Department<select id="md-department"><option value="">All departments</option></select></label>
        <button id="md-apply" class="button compact" type="submit" disabled>Apply</button>
      </form>
      <div id="md-results" hidden>
        <div class="md-result-head"><div><h3>NEW / FURTHER split</h3><p id="md-scope" class="md-note"></p></div>
          <div class="inline-actions"><label class="md-check"><input id="md-comparison" type="checkbox">Comparison columns</label><button id="md-export-summary" class="button compact" type="button">Export split CSV</button></div></div>
        <p id="md-coverage" class="md-warning" role="status"></p>
        <div class="md-scroll"><table class="md-table"><thead id="md-summary-head"></thead><tbody id="md-summary"></tbody></table></div>
        <div class="md-narrative"><p id="md-narrative"></p><button id="md-copy" class="button compact" type="button">Copy trade summary</button></div>
        <details class="md-details"><summary>Product results &amp; match review <span id="md-review-count"></span></summary>
          <div class="md-controls"><label>Results<select id="md-show"><option value="all">All styles</option><option value="NEW">NEW</option><option value="FURTHER">FURTHER</option><option value="review">Needs review</option></select></label>
          <label class="md-search">Product / SKU<input id="md-search" type="search" placeholder="Search products"></label><button id="md-export-products" class="button compact" type="button">Export product CSV</button></div>
          <div class="md-scroll md-product-scroll"><table class="md-table"><thead id="md-product-head"></thead><tbody id="md-products"></tbody></table></div>
        </details>
      </div>`;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) lists = stored.filter(list => list && typeof list.id === "string" && Array.isArray(list.actions) && list.actions.length && list.actions.every(row => row && typeof row.sku === "string" && ["NEW", "FURTHER"].includes(row.action)) && /^\d{4}-\d{2}-\d{2}$/.test(list.launchDate));
    } catch { message("Saved lists could not be read. Import a list to continue.", true); }
    $("upload").addEventListener("change", importFiles);
    $("pending").addEventListener("change", preview);
    $("retail").addEventListener("change", previewAvailability);
    $("import").addEventListener("submit", addList);
    $("list").addEventListener("change", chooseList);
    $("remove").addEventListener("click", removeList);
    $("mode").addEventListener("change", () => { seedPeriods(); dirty(); });
    for (const id of ["start", "end", "before-start", "before-end"]) $(id).addEventListener("input", () => { $("mode").value = "custom"; dirty(); });
    for (const id of ["region", "brand", "department"]) $(id).addEventListener("change", dirty);
    $("periods").addEventListener("submit", event => { event.preventDefault(); calculate(); });
    $("comparison").addEventListener("change", renderSummary);
    $("show").addEventListener("change", renderProducts);
    $("search").addEventListener("input", renderProducts);
    $("product-head").addEventListener("click", event => {
      const button = event.target.closest("[data-md-sort]");
      if (!button) return;
      sort = { key: button.dataset.mdSort, direction: sort.key === button.dataset.mdSort ? -sort.direction : -1 };
      renderProducts();
    });
    $("export-summary").addEventListener("click", () => exportData(false));
    $("export-products").addEventListener("click", () => exportData(true));
    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("scope").textContent + "\n" + $("narrative").textContent + "\n" + $("coverage").textContent); message("Trade summary copied."); }
      catch { message("Clipboard unavailable. Select the trade summary text to copy it.", true); }
    });
    refreshLists();
    if (lists.length) chooseList();
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lists)); return true; }
    catch { message("Browser storage is full or unavailable. This list is available for this session only.", true); return false; }
  }
  function refreshLists(id) {
    $("list").innerHTML = lists.length ? lists.map(list => option(list.id, `${list.launchDate} | ${list.fileName} | ${list.sheetName}`)).join("") : option("", "No lists");
    if (id) $("list").value = id;
    $("remove").disabled = $("apply").disabled = !lists.length;
  }
  function dirty() {
    run += 1;
    result = null;
    $("results").hidden = true;
    $("apply").disabled = !selected();
    if (selected()) message("Changes pending. Apply to calculate.");
  }
  function chooseList() {
    dirty();
    const list = selected();
    $("brand").innerHTML = option("", "All brands") + [...new Set((list?.actions || []).map(row => row.brand))].sort().map(value => option(value, value)).join("");
    $("department").innerHTML = option("", "All departments") + [...new Set((list?.actions || []).map(row => row.department))].sort().map(value => option(value, value)).join("");
    $("mode").value = "launch";
    $("region").value = "";
    seedPeriods();
  }
  function seedPeriods() {
    const list = selected();
    if (!list || $("mode").value === "custom") return;
    const period = MarkdownCore.presets(list.launchDate, $("mode").value);
    $("start").value = period.currentStart; $("end").value = period.currentEnd;
    $("before-start").value = period.beforeStart; $("before-end").value = period.beforeEnd;
  }
  function removeList() {
    const list = selected();
    if (!list || !window.confirm(`Remove ${list.fileName} (${list.launchDate}) from this browser?`)) return;
    lists = lists.filter(item => item.id !== list.id);
    persist(); refreshLists(); chooseList();
    if (!lists.length) message("No markdown lists imported.");
  }
  async function importFiles() {
    const files = Array.from($("upload").files);
    $("upload").disabled = true;
    let maxDate = "";
    for (const file of state.files) if (file.maxDate > maxDate) maxDate = file.maxDate;
    const year = Number(maxDate.slice(0, 4)) || new Date().getFullYear();
    const failures = [];
    for (const file of files) {
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error("File exceeds the 50 MB import limit.");
        message(`Reading ${file.name}...`);
        if (/\.csv$/i.test(file.name)) {
          const rows = parseCsvRows((await file.text()).replace(/^\uFEFF/, ""));
          const list = MarkdownCore.parseList(rows, file.name.replace(/\.csv$/i, ""));
          if (!list) throw new Error("Required columns: STYLE ID (or SKU) and ACTION.");
          pending.push({ ...list, fileName: file.name, launchDate: MarkdownCore.guessLaunch(file.name, rows, year) });
        } else {
          const buffer = await file.arrayBuffer();
          const received = await new Promise((resolve, reject) => {
            const worker = new Worker("markdown-import-worker.js");
            const timer = setTimeout(() => { worker.terminate(); reject(new Error("Workbook import timed out. Export the markdown sheet as CSV.")); }, 90000);
            const stop = () => { clearTimeout(timer); worker.terminate(); };
            worker.onmessage = event => { stop(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.lists); };
            worker.onerror = () => { stop(); reject(new Error("Workbook reader unavailable. Check your connection to cdn.sheetjs.com, or import CSV.")); };
            worker.postMessage({ buffer, name: file.name, year }, [buffer]);
          });
          pending.push(...received);
        }
      } catch (error) { failures.push(`${file.name}: ${error.message}`); }
    }
    $("upload").disabled = false; $("upload").value = "";
    pending.sort((a, b) => Number(a.retailOnly) - Number(b.retailOnly));
    renderPending();
    message(failures.length ? failures.join(" ") : "Confirm the go-live date and sheet before adding each list.", !!failures.length);
  }
  function renderPending() {
    $("import").hidden = !pending.length;
    $("pending").innerHTML = pending.map((list, index) => option(index, `${list.fileName} | ${list.sheetName}`)).join("");
    preview();
  }
  function preview() {
    const list = pending[Number($("pending").value)];
    if (!list) return;
    $("launch").value = list.launchDate;
    $("retail").checked = false;
    $("retail-label").hidden = !list.retailOnly;
    const groups = ["NEW", "FURTHER"].map(action => `${list.actions.filter(row => row.action === action).length} ${action}`).join(" / ");
    $("preview").textContent = `${groups}. ${list.duplicates ? `${list.duplicates} duplicate rows consolidated. ` : ""}${list.retailOnly ? "Retail Only: verify online applicability. " : ""}${list.issues.length ? `${list.issues.length} invalid rows; correct the source before import. ${list.issues.slice(0, 2).join(" ")}` : ""}`;
    previewAvailability();
  }
  function previewAvailability() {
    const list = pending[Number($("pending").value)];
    $("add").disabled = !list || list.issues.length > 0 || (list.retailOnly && !$("retail").checked);
  }
  function addList(event) {
    event.preventDefault();
    const index = Number($("pending").value), list = pending[index];
    if (!list || $("add").disabled) return;
    const launchDate = $("launch").value;
    try { MarkdownCore.days(launchDate, launchDate); } catch (error) { message(error.message, true); return; }
    const signature = JSON.stringify(list.actions.map(row => [row.sku, row.action]).sort());
    if (lists.some(item => item.launchDate === launchDate && item.sheetName === list.sheetName && JSON.stringify(item.actions.map(row => [row.sku, row.action]).sort()) === signature)) { message("This launch list is already saved. Remove it first to replace it.", true); return; }
    const saved = { ...list, launchDate, id: crypto.randomUUID() };
    lists.push(saved); pending.splice(index, 1);
    refreshLists(saved.id); renderPending(); chooseList();
    if (persist()) message("List saved. Apply to calculate its performance.");
  }
  function activate() {
    if (!root) return;
    if (source && source !== getAnalysisRecords()) { dirty(); message("Sales data changed. Apply to refresh markdown results."); }
  }
  async function calculate() {
    const list = selected();
    if (!list) return;
    const options = { currentStart: $("start").value, currentEnd: $("end").value, beforeStart: $("before-start").value, beforeEnd: $("before-end").value, brand: $("brand").value, department: $("department").value, region: $("region").value };
    const token = ++run;
    try {
      const accumulator = MarkdownCore.createAnalysis(list.actions, options);
      const records = getAnalysisRecords();
      if (!records.length) throw new Error("No sales data loaded. Refresh shared data in Settings first.");
      result = null; $("results").hidden = true; $("apply").disabled = true;
      for (let offset = 0; offset < records.length; offset += 20000) {
        if (token !== run) return;
        if (records !== getAnalysisRecords()) throw new Error("Sales data changed during calculation. Apply again.");
        const end = Math.min(offset + 20000, records.length);
        for (let i = offset; i < end; i += 1) accumulator.add(records[i]);
        message(`Checking ${count.format(end)} of ${count.format(records.length)} sales rows...`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (token !== run) return;
      result = { ...accumulator.finish(), list };
      source = records;
      renderResults();
      message("Markdown results updated.");
    } catch (error) { message(error.message || "Unable to calculate markdown results.", true); }
    finally { if (token === run) $("apply").disabled = false; }
  }
  function renderResults() {
    $("results").hidden = false;
    const { options, list } = result;
    $("scope").textContent = `${list.launchDate} launch | Current ${options.currentStart} to ${options.currentEnd} | Before ${options.beforeStart} to ${options.beforeEnd} | ${options.region || "All regions"} | ${options.brand || "All brands"} | ${options.department || "All departments"} | All price statuses | Period totals`;
    const unmatched = result.rows.filter(row => !row.matched).length;
    const notes = [];
    if (unmatched) notes.push(`Provisional: ${unmatched} of ${result.rows.length} styles need review; they are excluded from totals, not assumed zero.`);
    if (result.missingCurrent.length) notes.push(`Current period: ${result.missingCurrent.length} dates have no loaded sales rows (${result.missingCurrent.join(", ")}); current totals unavailable.`);
    if (result.missingBefore.length) notes.push(`Before period: ${result.missingBefore.length} dates have no loaded sales rows (${result.missingBefore.join(", ")}); comparisons unavailable.`);
    if (result.currentDays !== result.beforeDays) notes.push(`Unequal periods: ${result.currentDays} current days versus ${result.beforeDays} before days. Changes compare totals, not daily rates.`);
    if (options.currentStart < list.launchDate) notes.push("Current period includes pre-launch dates.");
    const reprice = new Set(lists.filter(other => other.id !== list.id && other.launchDate > list.launchDate && other.launchDate <= options.currentEnd && other.launchDate >= options.currentStart).flatMap(other => other.actions.map(row => row.sku)));
    const repriced = result.rows.filter(row => reprice.has(row.sku)).length;
    if (repriced) notes.push(`${repriced} styles appear on another saved launch list during the current period; response includes another price action.`);
    if (!result.rows.length) notes.push("No styles match the selected brand and department.");
    $("coverage").textContent = notes.join(" ") || "All selected styles matched. Sales share is within this list and selected scope.";
    $("coverage").classList.toggle("is-clear", !notes.length);
    $("review-count").textContent = `${result.rows.length} styles / ${unmatched} unmatched`;
    const sentences = result.summaries.filter(row => row.styles).map(row => `${row.action}: ${currency(row.currentSales)}, ${units(row.currentUnits)} net units and ${pct(row.share)} of matched list sales (${row.matched}/${row.styles} styles matched).`);
    const drivers = result.rows.filter(row => row.currentSales > 0).sort((a, b) => b.currentSales - a.currentSales).slice(0, 3);
    if (drivers.length) sentences.push(`Top sales contributors: ${drivers.map(row => `${row.product} (${row.action}, ${currency(row.currentSales)})`).join("; ")}.`);
    sentences.push("Sales mix describes these product cohorts, not a causal measure of markdown effectiveness.");
    $("narrative").textContent = sentences.join(" ");
    renderSummary(); renderProducts();
  }
  function renderSummary() {
    if (!result) return;
    const compare = $("comparison").checked;
    $("summary-head").innerHTML = `<tr>${["Action", "Styles matched", "Net sales", "Sales share", "Net units", ...(compare ? ["Before sales", "Before units", "Sales change", "Change %", "Units change"] : [])].map(label => `<th scope="col">${label}</th>`).join("")}</tr>`;
    $("summary").innerHTML = result.summaries.map(row => `<tr><th scope="row"><span class="md-action ${row.action.toLowerCase()}">${row.action}</span></th><td>${row.matched} / ${row.styles}</td><td>${currency(row.currentSales)}</td><td class="md-share"><span style="width:${Math.max(0, Math.min(100, (row.share || 0) * 100))}%" class="${row.action.toLowerCase()}"></span><b>${pct(row.share)}</b></td><td>${units(row.currentUnits)}</td>${compare ? `<td>${currency(row.beforeSales)}</td><td>${units(row.beforeUnits)}</td><td>${currency(row.change)}</td><td>${pct(row.changePct)}</td><td>${units(row.unitChange)}</td>` : ""}</tr>`).join("");
  }
  function visibleRows() {
    if (!result) return [];
    const query = $("search").value.trim().toLowerCase(), show = $("show").value;
    return result.rows.filter(row => (show === "all" || (show === "review" ? row.review !== "Matched" : row.action === show)) && (!query || `${row.sku} ${row.product}`.toLowerCase().includes(query))).sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * sort.direction;
    });
  }
  function renderProducts() {
    if (!result) return;
    const columns = [["sku", "SKU"], ["product", "Product"], ["action", "Action"], ["currentSales", "Net sales"], ["currentUnits", "Net units"], ["change", "Sales change"], ["unitChange", "Units change"], ["review", "Match review"]];
    $("product-head").innerHTML = `<tr>${columns.map(([key, label]) => `<th scope="col" aria-sort="${sort.key === key ? sort.direction === 1 ? "ascending" : "descending" : "none"}"><button type="button" data-md-sort="${key}" title="Sort ${label}">${label} <span aria-hidden="true">${sort.key === key ? sort.direction === 1 ? "\u2191" : "\u2193" : "\u2195"}</span></button></th>`).join("")}</tr>`;
    const rows = visibleRows();
    $("products").innerHTML = rows.length ? rows.map(row => `<tr>${columns.map(([key]) => {
      const value = ["currentSales", "change"].includes(key) ? currency(row[key]) : ["currentUnits", "unitChange"].includes(key) ? units(row[key]) : row[key];
      return `<td class="md-${key === "action" ? "product-action" : key}" title="${escape(value)}">${escape(value)}</td>`;
    }).join("")}</tr>`).join("") : '<tr><td colspan="8">No results</td></tr>';
  }
  function exportData(products) {
    if (!result) return;
    const options = result.options;
    const contextHeaders = ["Launch date", "List", "Sheet", "Current start", "Current end", "Before start", "Before end", "Region", "Brand filter", "Department filter", "Current missing dates", "Before missing dates", "Price status scope", "Comparison basis"];
    const context = [result.list.launchDate, result.list.fileName, result.list.sheetName, options.currentStart, options.currentEnd, options.beforeStart, options.beforeEnd, options.region || "All", options.brand || "All", options.department || "All", result.missingCurrent.join("; "), result.missingBefore.join("; "), "All", "Total"];
    const round = value => typeof value === "number" ? Math.round(value * 100) / 100 : value;
    const headers = products ? ["SKU", "Product", "Action", "Brand", "Department", "Previous price", "New price", "Additional reduction %", "Net sales", "Net units", "Sales share %", "Before sales", "Before units", "Sales change", "Change %", "Units change", "Match review"] : ["Action", "Listed styles", "Matched styles", "Unmatched styles", "Net sales", "Net units", "Sales share %", "Before sales", "Before units", "Sales change", "Change %", "Units change"];
    const data = (products ? visibleRows() : result.summaries).map(row => [
      ...context,
      ...(products ? [row.sku, row.product, row.action, row.brand, row.department, row.oldPrice, row.newPrice, row.oldPrice > 0 && row.newPrice !== null ? round((1 - row.newPrice / row.oldPrice) * 100) : null] : [row.action, row.styles, row.matched, row.review]),
      round(row.currentSales), row.currentUnits, row.share === null ? null : round(row.share * 100), round(row.beforeSales), row.beforeUnits, round(row.change), row.changePct === null ? null : round(row.changePct * 100), row.unitChange,
      ...(products ? [row.review] : [])
    ]);
    downloadFile(`markdown-${products ? "products" : "split"}-${result.list.launchDate}-${options.currentStart}-to-${options.currentEnd}.csv`, MarkdownCore.csv([[...contextHeaders, ...headers], ...data]), "text/csv;charset=utf-8");
    message(`${products ? data.length + " product rows" : "NEW / FURTHER split"} exported.`);
  }
  return { init, activate };
})();
