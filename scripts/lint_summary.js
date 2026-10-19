// Summarizes eslint JSON output into compact per-file per-rule counts.
// Usage: eslint . -f json -o eslint_warnings.json && node scripts/lint_summary.js
const fs = require("fs");
const TARGET_RULES = new Set([
  "@typescript-eslint/no-explicit-any",
  "@next/next/no-img-element",
  "react-hooks/exhaustive-deps",
  "react-hooks/set-state-in-effect",
]);
const raw = fs.readFileSync("eslint_warnings.json", "utf8");
const r = JSON.parse(raw);
const out = {};
let total = 0;
let totalAll = 0;
for (const f of r) {
  totalAll += f.messages.length;
  for (const m of f.messages) {
    if (!TARGET_RULES.has(m.ruleId)) continue;
    const p = f.filePath.split(/[\\/]inv_mgmt[\\/]/).pop().replace(/\\/g, "/");
    out[p] = out[p] || {};
    out[p][m.ruleId] = (out[p][m.ruleId] || 0) + 1;
    total++;
  }
}
console.log(JSON.stringify({ total, totalAllWarnings: totalAll, files: out }));
