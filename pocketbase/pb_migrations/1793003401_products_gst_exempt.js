/// <reference path="../pb_data/types.d.ts" />

// Explicit 0% GST: products.gst_rate uses 0 for "not configured" (falls back
// to the 3% jewellery default), so exemption needs its own unambiguous flag.
migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  products.fields.add(new BoolField({ name: "gst_exempt" }));
  app.save(products);
}, (app) => {
  const products = app.findCollectionByNameOrId("products");
  products.fields.removeByName("gst_exempt");
  app.save(products);
});
