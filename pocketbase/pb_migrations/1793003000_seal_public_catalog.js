/// <reference path="../pb_data/types.d.ts" />

/**
 * Security Remediation: Seal direct unauthenticated public access to products and product_variants collections.
 *
 * Proprietary wholesale cost_price, channel markups, and supplier links were exposed to anonymous callers
 * via direct PocketBase queries. Public storefront visitors must now exclusively use the sanitized
 * Next.js API (/api/storefront/catalog) which redacts sensitive fields.
 */

const TENANT_MEMBER =
  '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
const TENANT_BODY_OWNER =
  '(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';

migrate((app) => {
  try {
    const products = app.findCollectionByNameOrId("pbc_4092854851") || app.findCollectionByNameOrId("products");
    if (products) {
      unmarshal({
        "listRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
        "viewRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
        "createRule": `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
        "updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
        "deleteRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
      }, products);
      app.save(products);
    }
  } catch (e) { /* ignore */ }

  try {
    const variants = app.findCollectionByNameOrId("pbc_1715963891") || app.findCollectionByNameOrId("product_variants");
    if (variants) {
      unmarshal({
        "listRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
        "viewRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
        "createRule": `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
        "updateRule": `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
        "deleteRule": `@request.auth.id != "" && ${TENANT_MEMBER}`,
      }, variants);
      app.save(variants);
    }
  } catch (e) { /* ignore */ }
}, (app) => {
  try {
    const products = app.findCollectionByNameOrId("pbc_4092854851") || app.findCollectionByNameOrId("products");
    if (products) {
      products.listRule = `${TENANT_MEMBER} || (@request.auth.id = "" && is_active = true)`;
      products.viewRule = `${TENANT_MEMBER} || (@request.auth.id = "" && is_active = true)`;
      app.save(products);
    }
  } catch (e) {}

  try {
    const variants = app.findCollectionByNameOrId("pbc_1715963891") || app.findCollectionByNameOrId("product_variants");
    if (variants) {
      variants.listRule = `${TENANT_MEMBER} || (@request.auth.id = "" && product.is_active = true)`;
      variants.viewRule = `${TENANT_MEMBER} || (@request.auth.id = "" && product.is_active = true)`;
      app.save(variants);
    }
  } catch (e) {}
});
