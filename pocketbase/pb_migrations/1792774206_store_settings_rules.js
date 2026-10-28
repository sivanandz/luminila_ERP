/// <reference path="../pb_data/types.d.ts" />

/**
 * Tenant-scopes `store_settings` collection rules (audit 2026-10-22, finding #8).
 *
 * APPLIED (2026-10-23, commit "apply and verify the migration bundle"); the
 * earlier DRAFT banner was left behind by mistake. The live rules were
 * `@request.auth.id != ""`, so any authenticated user could read or write every
 * row when a single PocketBase instance serves more than one tenant. Today each
 * tenant normally has its own SQLite file, which is why this never caused a
 * breach; the rules should still match the code's assumption.
 *
 * Legacy rows written before tenancy have an empty `account_email`. They stay
 * readable by any authenticated operator so an upgrade does not hide existing
 * settings; rows that name a tenant are visible only to that tenant's user.
 * The server itself authenticates as a superuser, which bypasses rules, so the
 * application keeps working during a rolling upgrade.
 *
 * Rollback restores the previous permissive rules exactly.
 */

const TENANT_RULE = '@request.auth.id != "" && (account_email = "" || account_email = @request.auth.email)';
const LEGACY_RULE = '@request.auth.id != ""';

migrate((app) => {
  const settings = app.findCollectionByNameOrId("store_settings");

  settings.listRule = TENANT_RULE;
  settings.viewRule = TENANT_RULE;
  settings.updateRule = TENANT_RULE;
  settings.deleteRule = TENANT_RULE;
  // Creation cannot compare a field before it exists; require an authenticated user.
  settings.createRule = LEGACY_RULE;

  app.save(settings);
}, (app) => {
  const settings = app.findCollectionByNameOrId("store_settings");

  settings.listRule = LEGACY_RULE;
  settings.viewRule = LEGACY_RULE;
  settings.updateRule = LEGACY_RULE;
  settings.deleteRule = LEGACY_RULE;
  settings.createRule = null;

  app.save(settings);
});
