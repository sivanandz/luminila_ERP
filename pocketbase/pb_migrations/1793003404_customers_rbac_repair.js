/// <reference path="../pb_data/types.d.ts" />

/**
 * T-05 repair: 1793003403 first shipped a `role.permissions ?= "…"` predicate
 * that PocketBase accepts at save time but fails to evaluate (every customers
 * write returned 400). Databases that already ran it hold the broken rule.
 * Re-apply the corrected, name-based writer predicate (Admin/Manager/Staff or
 * the tenant owner). For fresh databases this is a no-op rewrite of the same
 * values 1793003403 now installs.
 */

const TENANT_MEMBER =
  '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
const TENANT_BODY_OWNER =
  '(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';
const CUSTOMER_WRITER =
  '(@request.auth.id != "" && (@request.auth.email = account_email || (@collection.user_roles:auth.user ?= @request.auth.id && (@collection.user_roles:auth.role.name ?= "Admin" || @collection.user_roles:auth.role.name ?= "Manager" || @collection.user_roles:auth.role.name ?= "Staff"))))';

const PREV_RULES = {
  createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
  updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
};

migrate((app) => {
  const col = app.findCollectionByNameOrId("customers");
  if (!col) return;
  unmarshal({
    createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER} && ${CUSTOMER_WRITER}`,
    updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false && ${CUSTOMER_WRITER}`,
  }, col);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("customers");
  if (!col) return;
  unmarshal(PREV_RULES, col);
  app.save(col);
});
