/// <reference path="../pb_data/types.d.ts" />

/**
 * Roadmap capture fields (2026-10-24, second pass).
 *
 * Consent ledger (A30): DPDP/WhatsApp opt-in needs an auditable event trail, not
 * just the latest boolean on the customer. `consent_events` is append-only
 * (no update/delete rules) and tenant-scoped.
 *
 * Chat ↔ order relation (A32): `whatsapp_messages.order` and
 * `whatsapp_chats.last_order` let the conversation show which order it produced.
 *
 * Campaign relation (A37): the UTM name is stored on the order (`campaign`) and
 * on the POS mirror (`campaign_name`), and a matching campaign row can be linked
 * through the existing `sales.campaign` relation. `storefront` joins the campaign
 * channel enum so website attribution is not forced into "whatsapp".
 *
 * Billing/GSTIN capture (A3/A4): the order keeps the buyer's GSTIN and company
 * name so an invoice does not depend on the customer profile being edited later.
 *
 * COD settlement (D2): `cod_settled_at` / `cod_reference` record when and how the
 * cash was collected; `cod` joins the payment-link provider enum for the ledger
 * row that settlement writes.
 *
 * Down removes the added fields/collection and the enum values.
 */

migrate((app) => {
  const orders = app.findCollectionByNameOrId("sales_orders");
  const orderFields = orders.fields.fieldNames();
  for (const name of ["campaign", "buyer_gstin", "buyer_company", "whatsapp_chat", "cod_reference"]) {
    if (!orderFields.includes(name)) orders.fields.add(new TextField({ name }));
  }
  if (!orderFields.includes("cod_settled_at")) {
    orders.fields.add(new DateField({ name: "cod_settled_at" }));
  }
  if (!orders.indexes.some((index) => index.includes("idx_sales_orders_whatsapp_chat"))) {
    orders.indexes = orders.indexes.concat([
      "CREATE INDEX idx_sales_orders_whatsapp_chat ON sales_orders (whatsapp_chat) WHERE whatsapp_chat != ''",
    ]);
  }
  app.save(orders);

  const sales = app.findCollectionByNameOrId("sales");
  if (!sales.fields.fieldNames().includes("campaign_name")) {
    sales.fields.add(new TextField({ name: "campaign_name" }));
  }
  app.save(sales);

  const campaigns = app.findCollectionByNameOrId("whatsapp_campaigns");
  for (const field of campaigns.fields) {
    if (field.name === "channel" && field.values && !field.values.includes("storefront")) {
      field.values = field.values.concat(["storefront"]);
    }
  }
  app.save(campaigns);

  const links = app.findCollectionByNameOrId("payment_links");
  for (const field of links.fields) {
    if (field.name === "provider" && field.values && !field.values.includes("cod")) {
      field.values = field.values.concat(["cod"]);
    }
  }
  app.save(links);

  const messages = app.findCollectionByNameOrId("whatsapp_messages");
  if (!messages.fields.fieldNames().includes("order")) {
    messages.fields.add(new RelationField({
      name: "order",
      collectionId: orders.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  app.save(messages);

  const chats = app.findCollectionByNameOrId("whatsapp_chats");
  if (!chats.fields.fieldNames().includes("last_order")) {
    chats.fields.add(new RelationField({
      name: "last_order",
      collectionId: orders.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  app.save(chats);

  const customers = app.findCollectionByNameOrId("customers");
  // Create the collection first, then add its fields, then apply rules: rules
  // are validated against the saved field layout, so setting them in the same
  // constructor call as the fields fails with "unknown field account_email".
  const consent = new Collection({
    name: "consent_events",
    type: "base",
  });
  consent.fields.add(new TextField({ name: "account_email" }));
  consent.fields.add(new RelationField({ name: "customer", collectionId: customers.id, maxSelect: 1, cascadeDelete: false }));
  consent.fields.add(new TextField({ name: "phone" }));
  consent.fields.add(new SelectField({ name: "channel", values: ["storefront", "website", "whatsapp", "pos", "import", "system"] }));
  consent.fields.add(new SelectField({ name: "purpose", values: ["marketing", "transactional", "whatsapp_service"] }));
  consent.fields.add(new BoolField({ name: "granted" }));
  consent.fields.add(new TextField({ name: "source" }));
  consent.fields.add(new TextField({ name: "policy_version" }));
  consent.fields.add(new RelationField({ name: "order", collectionId: orders.id, maxSelect: 1, cascadeDelete: false }));
  consent.fields.add(new DateField({ name: "occurred_at" }));
  consent.fields.add(new TextField({ name: "notes" }));
  consent.indexes = [
    "CREATE INDEX idx_consent_events_customer ON consent_events (customer)",
    "CREATE INDEX idx_consent_events_phone ON consent_events (phone)",
    "CREATE INDEX idx_consent_events_account ON consent_events (account_email)",
  ];
  app.save(consent);

  consent.listRule = "account_email = @request.auth.email";
  consent.viewRule = "account_email = @request.auth.email";
  consent.createRule = "account_email = @request.auth.email";
  consent.updateRule = null;
  consent.deleteRule = null;
  app.save(consent);
}, (app) => {
  try {
    const consent = app.findCollectionByNameOrId("consent_events");
    app.delete(consent);
  } catch { /* already gone */ }

  const orders = app.findCollectionByNameOrId("sales_orders");
  for (const name of ["campaign", "buyer_gstin", "buyer_company", "whatsapp_chat", "cod_reference", "cod_settled_at"]) {
    orders.fields.removeByName(name);
  }
  orders.indexes = orders.indexes.filter((index) => !index.includes("idx_sales_orders_whatsapp_chat"));
  app.save(orders);

  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.removeByName("campaign_name");
  app.save(sales);

  for (const collectionName of ["whatsapp_campaigns", "payment_links"]) {
    const collection = app.findCollectionByNameOrId(collectionName);
    for (const field of collection.fields) {
      if (field.name === "channel" || field.name === "provider") {
        if (field.values) field.values = field.values.filter((value) => value !== "storefront" && value !== "cod");
      }
    }
    app.save(collection);
  }

  for (const [collectionName, fieldName] of [["whatsapp_messages", "order"], ["whatsapp_chats", "last_order"]]) {
    const collection = app.findCollectionByNameOrId(collectionName);
    collection.fields.removeByName(fieldName);
    app.save(collection);
  }
});