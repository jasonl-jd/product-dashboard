"use strict";

const DashboardPerformance = (() => {
  function dateIndex(records) {
    const days = new Map();
    for (const record of records) {
      const key = record.dateKey || "";
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(record);
    }
    const keys = [...days.keys()].sort();
    const dated = keys.filter(Boolean);
    return {
      summary: dated.length ? { min: dated[0], max: dated[dated.length - 1] } : null,
      select(start, end, accepts = () => true) {
        const result = [];
        for (const key of keys) {
          if (!key) continue;
          if ((start && key < start) || (end && key > end)) continue;
          for (const record of days.get(key)) if (accepts(record)) result.push(record);
        }
        return result;
      }
    };
  }

  function encode(records, keys, blank) {
    const values = keys.map(() => []);
    const codes = keys.map(() => new Map());
    const columns = keys.map(() => new Uint32Array(records.length));
    records.forEach((record, row) => {
      keys.forEach((key, dimension) => {
        const value = record[key] || blank;
        if (!codes[dimension].has(value)) {
          codes[dimension].set(value, values[dimension].length);
          values[dimension].push(value);
        }
        columns[dimension][row] = codes[dimension].get(value);
      });
    });
    return { values, codes, columns };
  }

  // A row failing one filter contributes only to that filter's own options.
  function countFacets(columns, sizes, allowed) {
    const counts = sizes.map(size => new Uint32Array(size));
    const active = allowed.map((mask, index) => mask ? index : -1).filter(index => index >= 0);
    for (let row = 0; row < (columns[0]?.length || 0); row++) {
      let failed = -1;
      for (const dimension of active) {
        if (!allowed[dimension][columns[dimension][row]]) {
          if (failed !== -1) { failed = -2; break; }
          failed = dimension;
        }
      }
      if (failed === -2) continue;
      if (failed >= 0) counts[failed][columns[failed][row]]++;
      else for (let dimension = 0; dimension < columns.length; dimension++) counts[dimension][columns[dimension][row]]++;
    }
    return counts;
  }

  async function mapLimit(items, limit, callback) {
    let next = 0;
    let failure;
    const results = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failure) {
        const index = next++;
        try { results[index] = await callback(items[index], index); }
        catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    return results;
  }

  return { dateIndex, encode, countFacets, mapLimit };
})();

if (typeof module !== "undefined") module.exports = DashboardPerformance;
