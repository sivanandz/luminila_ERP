/// <reference path="../pb_data/types.d.ts" />

/**
 * T-05: the customers capability gate lived only in React — any tenant member
 * (a Viewer has customers:["read"]) could write customers, loyalty value and
 * discounts straight through the data plane. Enforce the RBAC permission at
 * the PocketBase rule: create requires `customers:create`, update requires
 * `customers:update`, resolved through the user's role. The owner branch
 * (`@request.auth.email = account_email`) covers owners without a role row.
 * (Delete was already restricted to Admin/owner by 1793003200.)
 *
 * The `:auth` alias on the role join is mandatory: unscoped joins would let
 * any tenant's role row satisfy the predicate (A-02).
 */

const TENANT_MEMBER =
  '(@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email))';
const TENANT_BODY_OWNER =
  '(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';
// NOTE: the JSON `?=` permission predicate is accepted at save time but FAILS
// rule evaluation (400 on every write), so the write-capable default roles are
// matched by NAME. Custom roles must use one of these names to write customers.
const CUSTOMER_WRITER =
  '(@request.auth.id != "" && (@request.auth.email = account_email || (@collection.user_roles:auth.user ?= @request.auth.id && (@collection.user_roles:auth.role.name ?= "Admin" || @collection.user_roles:auth.role.name ?= "Manager" || @collection.user_roles:auth.role.name ?= "Staff"))))';

const OLD_RULES = {
  createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER}`,
  updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false`,
};

migrate((app) => {
  const col = app.findCollectionByNameOrId("customers");
  if (!col) return;
  unmarshal({
    ...OLD_RULES,
    createRule: `@request.auth.id != "" && ${TENANT_BODY_OWNER} && ${CUSTOMER_WRITER}`,
    updateRule: `@request.auth.id != "" && ${TENANT_MEMBER} && @request.body.account_email:isset = false && ${CUSTOMER_WRITER}`,
  }, col);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("customers");
  if (!col) return;
  unmarshal(OLD_RULES, col);
  app.save(col);
});
