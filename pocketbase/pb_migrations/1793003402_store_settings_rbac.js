/// <reference path="../pb_data/types.d.ts" />

/**
 * H-24: the canonical `store_config` row holds GSTIN, bank details and gateway
 * secrets. Any tenant member could PATCH/delete it because the rules only
 * checked tenant membership — the capability check lived in React.
 *
 * Scope the owner/Admin predicate to that one row so routine staff writes to
 * the other KV rows (gallery angles, carts, WhatsApp binding, quick-add memory…)
 * keep working. The `:auth` alias on the role join is mandatory: unscoped joins
 * would let any tenant's Admin edit another tenant's config.
 */

const TENANT_MEMBER =
  '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
const TENANT_BODY_OWNER =
  '(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';
const ADMIN_OR_OWNER =
  '(@request.auth.id != "" && (@request.auth.email = account_email || (@collection.user_roles:auth.user ?= @request.auth.id && @collection.user_roles:auth.role.name ?= "Admin")))';

const OLD_RULES = {
  listRule: `@request.auth.id != "" && ${TENANT_MEMBER}`,
  viewRule: `@request.auth.id != "" && ${TENANT_MEMBER}`,
  createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
  updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
  deleteRule: `@request.auth.id != "" && ${TENANT_MEMBER}`,
};

migrate((app) => {
  const col = app.findCollectionByNameOrId("store_settings");
  if (!col) return;
  unmarshal({
    ...OLD_RULES,
    createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER} && (category != "store_config" || ${ADMIN_OR_OWNER})`,
    updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false && (category != "store_config" || ${ADMIN_OR_OWNER})`,
    deleteRule: `@request.auth.id != "" && ${TENANT_MEMBER} && (category != "store_config" || ${ADMIN_OR_OWNER})`,
  }, col);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("store_settings");
  if (!col) return;
  unmarshal(OLD_RULES, col);
  app.save(col);
});
