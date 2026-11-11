/// <reference path="../pb_data/types.d.ts" />

/**
 * C-05 Remediation: Enforce RBAC at the data plane for destructive actions.
 *
 * Restrict delete operations on core business collections (customers, invoices, sales_orders)
 * so that only Tenant Owners or authenticated users with the Admin role can execute deletes.
 * Low-privilege staff tokens (Viewers, Cashiers) are rejected with 403 Forbidden.
 */

const ADMIN_OR_OWNER =
  '(@request.auth.id != "" && (@request.auth.email = account_email || (@collection.user_roles:auth.user ?= @request.auth.id && @collection.user_roles:auth.role.name ?= "Admin")))';

migrate((app) => {
  const collections = ["customers", "invoices", "sales_orders"];
  for (const name of collections) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        unmarshal({
          deleteRule: ADMIN_OR_OWNER,
        }, col);
        app.save(col);
      }
    } catch (e) { /* ignore */ }
  }
}, (app) => {
  const TENANT_MEMBER =
    '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
  const collections = ["customers", "invoices", "sales_orders"];
  for (const name of collections) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        col.deleteRule = `@request.auth.id != "" && ${TENANT_MEMBER}`;
        app.save(col);
      }
    } catch (e) { /* ignore */ }
  }
});
