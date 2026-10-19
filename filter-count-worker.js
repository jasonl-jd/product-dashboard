"use strict";
importScripts("performance-core.js");
let columns;
let sizes;
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    columns = data.columns;
    sizes = data.sizes;
    return;
  }
  const counts = DashboardPerformance.countFacets(columns, sizes, data.allowed);
  self.postMessage({ signature: data.signature, counts }, counts.map(count => count.buffer));
};
