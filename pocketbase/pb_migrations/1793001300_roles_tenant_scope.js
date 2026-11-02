/// <reference path="../pb_data/types.d.ts" />

/**
 * Tenant-scoped custom roles (A-02 residual).
 *
 * `roles` started as a shared catalog: the seeded Admin/Manager/Viewer rows are
 * genuinely global, but a tenant-created role was visible to (and editable by)
 * every other tenant. Custom roles now carry `account_email`; system roles and
 * legacy rows with an empty stamp stay shared.
 *
 * Rules use `@collection.user_roles:auth` so the "is this caller an Admin"
 * check is bound to one role-link row instead of two independent EXISTS checks.
 */

const ADMIN_JOIN =
    '@collection.user_roles:auth.user ?= @request.auth.id && @collection.user_roles:auth.role.name ?= "Admin"';
const TENANT_MATCH =
    '(account_email = @request.auth.email || account_email = @request.auth.account_email)';

migrate((app) => {
    const roles = app.findCollectionByNameOrId("roles");
    if (!roles.fields.find((field) => field.name === "account_email")) {
        roles.fields.add(new Field({
            name: "account_email",
            type: "text",
            required: false,
            max: 255,
        }));
    }

    unmarshal({
        // System roles and pre-scoping rows (empty stamp) stay visible to every
        // authenticated user; custom roles are visible to their tenant only.
        listRule: `@request.auth.id != "" && (is_system = true || account_email = "" || ${TENANT_MATCH})`,
        viewRule: `@request.auth.id != "" && (is_system = true || account_email = "" || ${TENANT_MATCH})`,
        createRule:
            `@request.auth.id != "" && ${ADMIN_JOIN} && ` +
            `(@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)`,
        // Only a non-system role owned by the caller's tenant may be changed.
        updateRule:
            `@request.auth.id != "" && is_system = false && ${TENANT_MATCH} && ` +
            `@request.body.account_email:isset = false && ${ADMIN_JOIN}`,
        deleteRule:
            `@request.auth.id != "" && is_system = false && ${TENANT_MATCH} && ${ADMIN_JOIN}`,
    }, roles);
    app.save(roles);
}, (app) => {
    const roles = app.findCollectionByNameOrId("roles");
    unmarshal({
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != "" && @collection.user_roles:auth.user ?= @request.auth.id && @collection.user_roles:auth.role.name ?= "Admin"',
        deleteRule: '@request.auth.id != ""',
    }, roles);
    app.save(roles);
    // Keep the field on rollback: dropping it would destroy custom-role scope.
});
