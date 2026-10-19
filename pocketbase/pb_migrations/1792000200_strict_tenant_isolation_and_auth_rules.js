/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // 1. Enforce active user rule on authentication
  try {
    const users = app.findCollectionByNameOrId("_pb_users_auth_");
    if (users) {
      users.authRule = "is_active = true";
      app.save(users);
    }
  } catch (e) {}

  // 2. Strict tenant isolation on products
  try {
    const products = app.findCollectionByNameOrId("pbc_4092854851");
    if (products) {
      unmarshal({
        "listRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && is_active = true)",
        "viewRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && is_active = true)",
        "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)",
        "updateRule": "@request.auth.id != \"\" && account_email = @request.auth.email && @request.body.account_email:isset = false",
        "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email"
      }, products);
      app.save(products);
    }
  } catch (e) {}

  // 3. Strict tenant isolation on product variants
  try {
    const variants = app.findCollectionByNameOrId("pbc_1715963891");
    if (variants) {
      unmarshal({
        "listRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && product.is_active = true)",
        "viewRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && product.is_active = true)",
        "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)",
        "updateRule": "@request.auth.id != \"\" && account_email = @request.auth.email && @request.body.account_email:isset = false",
        "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email"
      }, variants);
      app.save(variants);
    }
  } catch (e) {}

  // 4. Strict tenant isolation on business collections
  const strictCollections = [
    "customers",
    "sales",
    "sales_orders",
    "sale_items",
    "sales_order_items",
    "store_settings",
    "stock_movements"
  ];

  for (const name of strictCollections) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        unmarshal({
          "listRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
          "viewRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
          "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)",
          "updateRule": "@request.auth.id != \"\" && account_email = @request.auth.email && @request.body.account_email:isset = false",
          "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email"
        }, col);
        app.save(col);
      }
    } catch (e) {}
  }
}, (app) => {
  // rollback
});
