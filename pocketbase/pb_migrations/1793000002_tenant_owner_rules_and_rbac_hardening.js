/// <reference path="../pb_data/types.d.ts" />

/**
 * Tenant-owner rules and RBAC join hardening (2026-11-02).
 *
 * Two root causes from the codebase audit:
 *
 * 1. A-01 — every tenant rule compared `account_email = @request.auth.email`.
 *    Staff accounts authenticate with their personal email but their records
 *    carry the owner's `account_email`, so staff were locked out of all ERP
 *    reads/writes. Rules now accept either the login email or the tenant's
 *    `account_email`.
 *
 * 2. A-02 — `@collection.user_roles.user ?= @request.auth.id &&
 *    @collection.user_roles.role.name ?= "Admin"` evaluates as two independent
 *    EXISTS checks, so any user with any role could satisfy the second half
 *    against another tenant's Admin row. Both predicates are now bound to the
 *    same row with the `:auth` alias.
 *
 * Also backfills `user_roles.account_email` from the *owner's* account_email
 * (not the staff member's login email), so the tenant-scoped user list and
 * capability checks see staff role links.
 */

const AUTH_EMAIL = "@request.auth.email";
const ACCOUNT_EMAIL = "@request.auth.account_email";
const TENANT_BRANCH = `(account_email = ${AUTH_EMAIL} || account_email = ${ACCOUNT_EMAIL})`;
const BODY_BRANCH = `(@request.body.account_email = ${AUTH_EMAIL} || @request.body.account_email = ${ACCOUNT_EMAIL})`;
const BODY_PLACEHOLDER = "__luminila_body_account_email__";
const ADMIN_JOIN =
  '@collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
const ADMIN_JOIN_SCOPED =
  '@collection.user_roles:auth.user ?= @request.auth.id && @collection.user_roles:auth.role.name ?= "Admin"';

/** Rewrite one rule string; returns null when nothing changed. */
function hardenRule(rule, withAccountEmail) {
  if (!rule) return null;
  let next = String(rule);

  if (withAccountEmail && next.indexOf(ACCOUNT_EMAIL) === -1) {
    // Replace the body predicate first behind a placeholder: it contains
    // `account_email = @request.auth.email` and would otherwise be mangled
    // into `@request.body.(...)`.
    next = next.split(`@request.body.account_email = ${AUTH_EMAIL}`).join(BODY_PLACEHOLDER);
    next = next.split(`account_email = ${AUTH_EMAIL}`).join(TENANT_BRANCH);
    next = next.split(BODY_PLACEHOLDER).join(BODY_BRANCH);
  }

  if (next.indexOf(":auth") === -1) {
    next = next.split(ADMIN_JOIN).join(ADMIN_JOIN_SCOPED);
  }

  return next === String(rule) ? null : next;
}

migrate((app) => {
  let collections = [];
  try {
    collections = app.findAllCollections();
  } catch (e) {
    collections = [];
  }

  for (const col of collections) {
    if (!col) continue;
    try {
      const hasAccountEmail = col.fields.some((f) => f.name === "account_email");
      const updates = {};
      for (const key of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
        const next = hardenRule(col[key], hasAccountEmail);
        if (next !== null) updates[key] = next;
      }
      if (Object.keys(updates).length > 0) {
        unmarshal(updates, col);
        app.save(col);
      }
    } catch (e) {
      // One malformed collection must not abort the rest of the hardening pass.
    }
  }

  // Backfill role links to the tenant owner, not the staff member's login
  // email. Rows previously backfilled with `user.email` would disappear from
  // the owner's tenant-scoped `/users` listing.
  let links = [];
  try {
    links = app.findRecordsByFilter("user_roles", "id != ''", "", 0, 0);
  } catch (e) {
    links = [];
  }
  for (const link of links) {
    try {
      const owner = app.findRecordById("users", link.getString("user"));
      const tenant = String(owner.getString("account_email") || owner.email() || "").trim().toLowerCase();
      if (!tenant) continue;
      if (link.getString("account_email") !== tenant) {
        link.set("account_email", tenant);
        app.save(link);
      }
    } catch (e) {
      // Dangling user reference: leave the row untouched.
    }
  }
}, (app) => {
  // Rule hardening is intentionally not reverted: restoring the old rules
  // would re-open the cross-tenant privilege escalation.
});
