/// <reference path="../pb_data/types.d.ts" />

/**
 * Channel-order capture fields (2026-10-24).
 *
 * CO-14: the web channel forced `buyerStateCode = sellerStateCode`, so IGST
 * could never be charged on an inter-state sale. The buyer's state code and the
 * derived place of supply need to live on the order, not only on the customer
 * (a returning customer can ship to a different state).
 *
 * CO-05 groundwork: the gateway identifiers and the payment method were stored
 * only inside `internal_notes` text, so a Razorpay payment could not be mapped
 * back to an order and no column could be queried for reconciliation. These
 * columns make the mapping durable; the unique index on `gateway_order_id`
 * keeps a retried gateway-order creation idempotent.
 *
 * Down removes the columns and the index.
 */

migrate((app) => {
  const orders = app.findCollectionByNameOrId("sales_orders");
  const existing = orders.fields.fieldNames();

  const addText = (name) => {
    if (!existing.includes(name)) {
      orders.fields.add(new TextField({ name }));
    }
  };

  addText("payment_method");
  addText("buyer_state_code");
  addText("place_of_supply");
  addText("capture_source");
  addText("gateway");
  addText("gateway_order_id");
  addText("gateway_payment_id");

  if (!orders.indexes.some((index) => index.includes("idx_sales_orders_gateway_order"))) {
    orders.indexes = orders.indexes.concat([
      "CREATE UNIQUE INDEX idx_sales_orders_gateway_order ON sales_orders (gateway_order_id) WHERE gateway_order_id != ''",
    ]);
  }

  app.save(orders);
}, (app) => {
  const orders = app.findCollectionByNameOrId("sales_orders");
  for (const name of [
    "payment_method",
    "buyer_state_code",
    "place_of_supply",
    "capture_source",
    "gateway",
    "gateway_order_id",
    "gateway_payment_id",
  ]) {
    orders.fields.removeByName(name);
  }
  orders.indexes = orders.indexes.filter(
    (index) => !index.includes("idx_sales_orders_gateway_order")
  );
  app.save(orders);
});