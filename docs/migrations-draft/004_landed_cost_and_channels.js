/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — not applied. Review before running.
 *
 * Reporting columns and the campaign table that `campaign-attribution.ts`
 * already expects:
 *   - purchase_orders.overhead_amount: freight and duty stored as a number,
 *     which is the D-13 fix (today it lives inside the notes blob).
 *   - purchase_order_items.landed_unit_cost: the allocation written once, so
 *     two concurrent receipts cannot lose it.
 *   - sales.channel: counter, whatsapp, storefront, phone or export.
 *   - whatsapp_campaigns + sales.campaign: attribution that can be joined.
 */
migrate((app) => {
  const purchaseOrders = app.findCollectionByNameOrId("purchase_orders");
  purchaseOrders.fields.add(new NumberField({ name: "overhead_amount", min: 0 }));
  app.save(purchaseOrders);

  const purchaseItems = app.findCollectionByNameOrId("purchase_order_items");
  purchaseItems.fields.add(new NumberField({ name: "landed_unit_cost", min: 0 }));
  app.save(purchaseItems);

  const campaigns = new Collection({
    type: "base",
    name: "whatsapp_campaigns",
    listRule: '@request.auth.email != "" && account_email = @request.auth.email',
    viewRule: '@request.auth.email != "" && account_email = @request.auth.email',
    createRule: '@request.auth.email != "" && account_email = @request.auth.email',
    updateRule: '@request.auth.email != "" && account_email = @request.auth.email',
    deleteRule: '@request.auth.email != "" && account_email = @request.auth.email',
    fields: [
      { name: "account_email", type: "text", required: true, max: 255 },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "channel", type: "select", maxSelect: 1, values: ["whatsapp", "sms", "email"] },
      { name: "starts_at", type: "date" },
      { name: "ends_at", type: "date" },
      { name: "budget", type: "number", min: 0 },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "running", "completed", "cancelled"] },
    ],
  });
  app.save(campaigns);

  const savedCampaigns = app.findCollectionByNameOrId("whatsapp_campaigns");

  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.add(new SelectField({
    name: "channel",
    maxSelect: 1,
    values: ["counter", "whatsapp", "storefront", "phone", "export"],
  }));
  sales.fields.add(new RelationField({
    name: "campaign",
    collectionId: savedCampaigns.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  app.save(sales);
}, (app) => {
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.removeByName("channel");
  sales.fields.removeByName("campaign");
  app.save(sales);

  const campaignCollection = app.findCollectionByNameOrId("whatsapp_campaigns");
  app.delete(campaignCollection);

  const purchaseItems = app.findCollectionByNameOrId("purchase_order_items");
  purchaseItems.fields.removeByName("landed_unit_cost");
  app.save(purchaseItems);

  const purchaseOrders = app.findCollectionByNameOrId("purchase_orders");
  purchaseOrders.fields.removeByName("overhead_amount");
  app.save(purchaseOrders);
});
