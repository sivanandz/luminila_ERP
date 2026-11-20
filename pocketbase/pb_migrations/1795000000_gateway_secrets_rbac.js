/// <reference path="../pb_data/types.d.ts" />

/**
 * The /api/settings/secrets route (H-23) stores the four gateway secrets in a
 * dedicated `store_settings` row with key/category `gateway_secrets`, encrypted
 * at rest with TENANT_REGISTRY_KEY. 1793003402 Admin-gated only
 * `category = "store_config"` rows — the new category slipped past that gate,
 * so any tenant member could create, overwrite or delete their store's
 * `gateway_secrets` row directly against PocketBase, bypassing the route's
 * `settings:update` capability check (corrupting the encrypted secrets is a
 * gateway-config DoS; the values stay unreadable without the key).
 *
 * Gate writes on BOTH `key = "gateway_secrets"` (the route's own lookup) and
 * `category` so a crafted row cannot dodge the gate by mixing the two.
 * List/view stay tenant-member: the value is encrypted at rest and only the
 * capability-checked route decrypts it.
 */

const TENANT_MEMBER =
  '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
const TENANT_BODY_OWNER =
  '(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';
const ADMIN_OR_OWNER =
  '(@request.auth.id != "" && (@request.auth.email = account_email || (@collection.user_roles:auth.user ?= @request.auth.id && @collection.user_roles:auth.role.name ?= "Admin")))';

// The rules 1793003402 installed (restored verbatim by the down migration).
const RULES_3402 = {
  listRule: `@request.auth.id != "" && ${TENANT_MEMBER}`,
  viewRule: `@request.auth.id != "" && ${TENANT_MEMBER}`,
  createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER} && (category != "store_config" || ${ADMIN_OR_OWNER})`,
  updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false && (category != "store_config" || ${ADMIN_OR_OWNER})`,
  deleteRule: `@request.auth.id != "" && ${TENANT_MEMBER} && (category != "store_config" || ${ADMIN_OR_OWNER})`,
};

// Writes stay open only for rows that are neither the canonical config nor
// the secrets row, in either field.
const NOT_PRIVILEGED =
  '(key != "gateway_secrets" && category != "store_config" && category != "gateway_secrets")';

migrate((app) => {
  const col = app.findCollectionByNameOrId("store_settings");
  if (!col) return;
  unmarshal({
    ...RULES_3402,
    createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER} && (${NOT_PRIVILEGED} || ${ADMIN_OR_OWNER})`,
    updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false && (${NOT_PRIVILEGED} || ${ADMIN_OR_OWNER})`,
    deleteRule: `@request.auth.id != "" && ${TENANT_MEMBER} && (${NOT_PRIVILEGED} || ${ADMIN_OR_OWNER})`,
  }, col);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("store_settings");
  if (!col) return;
  unmarshal(RULES_3402, col);
  app.save(col);
});
