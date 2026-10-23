/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — not applied. Review before running.
 *
 * Adds the imitation taxonomy to products and the per-product GST rate that
 * D-14 needs (POS currently falls back to the category default).
 */
migrate((app) => {
  const products = app.findCollectionByNameOrId("products");

  products.fields.add(new TextField({ name: "craft", max: 40 }));
  products.fields.add(new TextField({ name: "plating", max: 40 }));
  products.fields.add(new TextField({ name: "occasion", max: 40 }));
  products.fields.add(new TextField({ name: "base_metal", max: 40 }));
  products.fields.add(new NumberField({ name: "gst_rate", min: 0, max: 28 }));

  app.save(products);
}, (app) => {
  const products = app.findCollectionByNameOrId("products");

  products.fields.removeByName("craft");
  products.fields.removeByName("plating");
  products.fields.removeByName("occasion");
  products.fields.removeByName("base_metal");
  products.fields.removeByName("gst_rate");

  app.save(products);
});
