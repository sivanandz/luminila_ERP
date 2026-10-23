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

  // The live database already has a `sales.channel` select with legacy values
  // (pos, shopify, wholesale, exhibition, marketplace, woocommerce, other).
  // Replace it and existing rows become invalid, so extend the enum instead.
  const LEGACY_CHANNELS = ["pos", "shopify", "whatsapp", "wholesale", "exhibition", "marketplace", "woocommerce", "other"];
  const APP_CHANNELS = ["counter", "storefront", "phone", "export"];
  const channelExists = sales.fields.fieldNames().includes("channel");

  if (channelExists) {
    const channelField = sales.fields.getByName("channel");
    const current = channelField.values || [];
    const merged = [];
    for (const value of [...current, ...LEGACY_CHANNELS, ...APP_CHANNELS]) {
      if (value && merged.indexOf(value) === -1) merged.push(value);
    }
    // Mutating .values on the existing field does not persist, and in the JSVM
    // `field.type` is a function rather than the string "select". The schema is
    // known to be a select, so replace the definition and carry its flags over.
    sales.fields.add(new SelectField({
      name: "channel",
      maxSelect: channelField.maxSelect || 1,
      required: channelField.required === true,
      values: merged,
    }));
  } else {
    sales.fields.add(new SelectField({
      name: "channel",
      maxSelect: 1,
      required: true,
      values: [...LEGACY_CHANNELS, ...APP_CHANNELS],
    }));
  }

  sales.fields.add(new RelationField({
    name: "campaign",
    collectionId: savedCampaigns.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  app.save(sales);
}, (app) => {
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.removeByName("campaign");

  // Restore the channel values that existed before this migration rather than
  // deleting a field that predates it.
  if (sales.fields.fieldNames().includes("channel")) {
    const channelField = sales.fields.getByName("channel");
    sales.fields.add(new SelectField({
      name: "channel",
      maxSelect: channelField.maxSelect || 1,
      required: channelField.required === true,
      values: ["pos", "shopify", "whatsapp", "wholesale", "exhibition", "marketplace", "woocommerce", "other"],
    }));
  }
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
