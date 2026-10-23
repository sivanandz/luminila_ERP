/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — not applied. Review before running.
 *
 * Index hardening only. The unique index on `invoices.order` closes the
 * duplicate-invoice race in D-20; the rest support lookups the reports now do.
 *
 * `order` is a SQL keyword, so it is quoted with backticks in the index DDL.
 * PocketBase refuses to create a unique index over existing duplicates, which
 * is why this must run only after checking for them.
 */
migrate((app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  invoices.indexes = invoices.indexes.concat([
    "CREATE UNIQUE INDEX idx_invoices_order ON invoices (`order`) WHERE `order` != ''",
    "CREATE INDEX idx_invoices_date ON invoices (account_email, invoice_date)",
  ]);
  app.save(invoices);

  const purchaseItems = app.findCollectionByNameOrId("purchase_order_items");
  purchaseItems.indexes = purchaseItems.indexes.concat([
    "CREATE INDEX idx_po_items_variant ON purchase_order_items (variant)",
  ]);
  app.save(purchaseItems);

  const sales = app.findCollectionByNameOrId("sales");
  sales.indexes = sales.indexes.concat([
    "CREATE INDEX idx_sales_channel ON sales (account_email, channel)",
  ]);
  app.save(sales);
}, (app) => {
  const drop = (collectionName, indexName) => {
    const collection = app.findCollectionByNameOrId(collectionName);
    collection.indexes = collection.indexes.filter((index) => !index.includes(indexName));
    app.save(collection);
  };

  drop("invoices", "idx_invoices_order");
  drop("invoices", "idx_invoices_date");
  drop("purchase_order_items", "idx_po_items_variant");
  drop("sales", "idx_sales_channel");
});
