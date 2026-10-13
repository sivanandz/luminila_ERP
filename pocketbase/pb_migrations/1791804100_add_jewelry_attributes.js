/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collectionIds = [
    "pbc_4092854851", // products
    "pbc_1715963891", // product_variants
    "pbc_3480387934", // sale_items
    "pbc_904955017"   // invoice_items
  ];

  const fieldDefs = [
    { name: "gross_weight", type: "number" },
    { name: "net_weight", type: "number" },
    { name: "stone_weight", type: "number" },
    { name: "stone_amount", type: "number" },
    { name: "purity_karat", type: "text" },
    { name: "making_charges", type: "number" },
    { name: "making_charges_type", type: "text" },
    { name: "wastage_percent", type: "number" },
    { name: "huid_code", type: "text" }
  ];

  for (let i = 0; i < collectionIds.length; i++) {
    const col = app.findCollectionByNameOrId(collectionIds[i]);
    if (!col) continue;

    for (let j = 0; j < fieldDefs.length; j++) {
      const def = fieldDefs[j];
      if (!col.fields.getByName(def.name)) {
        col.fields.add(new Field({
          name: def.name,
          type: def.type,
          required: false,
          presentable: false,
          system: false,
          hidden: false
        }));
      }
    }

    app.save(col);
  }
}, (app) => {
  const collectionIds = [
    "pbc_4092854851",
    "pbc_1715963891",
    "pbc_3480387934",
    "pbc_904955017"
  ];

  const fieldNames = [
    "gross_weight",
    "net_weight",
    "stone_weight",
    "stone_amount",
    "purity_karat",
    "making_charges",
    "making_charges_type",
    "wastage_percent",
    "huid_code"
  ];

  for (let i = 0; i < collectionIds.length; i++) {
    const col = app.findCollectionByNameOrId(collectionIds[i]);
    if (!col) continue;

    for (let j = 0; j < fieldNames.length; j++) {
      const field = col.fields.getByName(fieldNames[j]);
      if (field) {
        col.fields.removeById(field.id);
      }
    }

    app.save(col);
  }
});
