/// <reference path="../pb_data/types.d.ts" />

/**
 * Dual-identity tenant rules on the strict business collections (audit A-01,
 * rule half — regression of the original finding's partial fix).
 *
 * 1792000200 wrote rules of the form `account_email = @request.auth.email`
 * only. Staff accounts have `users.email !== users.account_email` (the owner
 * stamps `account_email`), so every strict collection denied them: they could
 * sign in but not read a product, order or sale. The client helpers were fixed
 * to prefer `account_email`, but without this migration the DB rules still
 * reject staff (1792774201 established the corrected dual-form pattern for
 * manufacturing jobs only).
 *
 * Every rule keeps its original shape and gains the
 * `account_email = @request.auth.account_email` alternative. Public storefront
 * reads (`@request.auth.id = ""` branches) and the create/update body guards
 * are preserved.
 */

const TENANT_MEMBER =
  '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
const TENANT_BODY_OWNER =
  '(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';

migrate((app) => {
  // ---- products (public read for active rows stays) ----
  try {
    const products = app.findCollectionByNameOrId("pbc_4092854851");
    if (products) {
      unmarshal({
        "listRule": `${TENANT_MEMBER} || (@request.auth.id = "" && is_active = true)`,
        "viewRule": `${TENANT_MEMBER} || (@request.auth.id = "" && is_active = true)`,
        "createRule": `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
        "updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
        "deleteRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
      }, products);
      app.save(products);
    }
  } catch (e) { /* collection absent in this build */ }

  // ---- product_variants (public read follows the product) ----
  try {
    const variants = app.findCollectionByNameOrId("pbc_1715963891");
    if (variants) {
      unmarshal({
        "listRule": `${TENANT_MEMBER} || (@request.auth.id = "" && product.is_active = true)`,
        "viewRule": `${TENANT_MEMBER} || (@request.auth.id = "" && product.is_active = true)`,
        "createRule": `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
        "updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
        "deleteRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
      }, variants);
      app.save(variants);
    }
  } catch (e) { /* collection absent in this build */ }

  // ---- strict business collections ----
  const strictCollections = [
    "customers",
    "sales",
    "sales_orders",
    "sale_items",
    "sales_order_items",
    "store_settings",
    "stock_movements",
  ];
  for (const name of strictCollections) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        unmarshal({
          "listRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
          "viewRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
          "createRule": `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
          "updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
          "deleteRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
        }, col);
        app.save(col);
      }
    } catch (e) { /* collection absent in this build */ }
  }
}, (app) => {
  // Rollback restores the strict single-identity rules from 1792000200.
  try {
    const users = app.findCollectionByNameOrId("_pb_users_auth_");
    if (users) {
      users.authRule = "is_active = true";
      app.save(users);
    }
  } catch (e) { /* ignore */ }
});
