// Seed the throwaway PocketBase (8099) with minimal E2E data. Run: node scripts/seed_throwaway_pb.js
const fs = require("fs");
const http = require("http");
function req(method, path, body, tok) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: "127.0.0.1", port: 8099, path, method, headers: Object.assign({ "Content-Type": "application/json" }, data ? { "Content-Length": Buffer.byteLength(data) } : {}, tok ? { Authorization: tok } : {}) },
      (resp) => { let d = ""; resp.on("data", (c) => (d += c)); resp.on("end", () => res({ code: resp.statusCode, body: d })); }
    );
    r.on("error", rej);
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  const a = JSON.parse(fs.readFileSync("pb_auth.json", "utf8"));
  const tok = a.token;
  let r = await req("POST", "/api/collections/users/records", { email: "admin@luminila.local", password: "Luminila2026!", passwordConfirm: "Luminila2026!", name: "Store Admin", verified: true, is_active: true }, tok);
  console.log("user:", r.code, r.code >= 400 ? r.body.slice(0, 200) : "ok");
  const keys = { store_name: "Luminila Test Store", store_email: "admin@luminila.local", store_phone: "+910000000000", store_address: "Test Lane 1", store_gstin: "29ABCDE1234F1Z5", store_state_code: "29", is_gst_registered: "true", currency: "INR", low_stock_threshold: "2", invoice_prefix: "INV/26-27/", upi_id: "test@upi" };
  for (const [k, v] of Object.entries(keys)) {
    const rr = await req("POST", "/api/collections/store_settings/records", { key: k, value: String(v), category: "general" }, tok);
    if (rr.code >= 400) console.log("setting", k, rr.code, rr.body.slice(0, 120));
  }
  console.log("store_settings seeded");
  r = await req("POST", "/api/collections/products/records", { name: "Test Gold Ring 22K", sku: "TEST-001", base_price: 10000, cost_price: 8000, is_active: true, tax_rate: 3, hsn_code: "7113", track_stock: true, description: "E2E test product" }, tok);
  console.log("product:", r.code, r.code >= 400 ? r.body.slice(0, 200) : "ok");
  const pid = JSON.parse(r.body).id;
  r = await req("POST", "/api/collections/product_variants/records", { product: pid, variant_name: "Default", sku_suffix: "DFT", price_adjustment: 0, stock_level: 10, low_stock_threshold: 2 }, tok);
  console.log("variant:", r.code, r.code >= 400 ? r.body.slice(0, 200) : "id=" + JSON.parse(r.body).id);
  r = await req("POST", "/api/collections/customers/records", { name: "E2E Test Customer", phone: "+919999000001", customer_type: "Retail", is_active: true }, tok);
  console.log("customer:", r.code, r.code >= 400 ? r.body.slice(0, 200) : "ok");
})();
