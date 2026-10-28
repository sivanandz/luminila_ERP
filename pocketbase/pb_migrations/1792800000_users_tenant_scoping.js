/// <reference path="../pb_data/types.d.ts" />

/**
 * Tenant-scope the `users` and `user_roles` collections (2026-10-24).
 *
 * Every business collection enforced `account_email = @request.auth.email`
 * except these two: their rules were `@request.auth.id != ""`, so any
 * authenticated tenant could list every user account in the system — the
 * cross-tenant leak reported on the /users page. `roles` stays global: it is
 * the shared RBAC catalog with no tenant PII.
 *
 * - Adds `account_email` to both collections.
 * - Backfills each users row with its own email (each existing account is its
 *   own tenant owner) and each user_roles row with its user's email.
 * - Scopes list/view to the tenant (plus self-access by record id).
 * - createRule forces the caller's tenant and an Admin role; update/delete
 *   keep the self-service and same-tenant-admin branches.
 *
 * Down restores the previous permissive rules and removes the fields.
 */

migrate((app) => {
    const users = app.findCollectionByNameOrId("users");
    if (!users.fields.find((f) => f.name === "account_email")) {
        users.fields.add(
            new TextField({
                name: "account_email",
                required: false,
            })
        );
    }
    users.listRule = '@request.auth.id != "" && (account_email = @request.auth.email || id = @request.auth.id)';
    users.viewRule = '@request.auth.id != "" && (account_email = @request.auth.email || id = @request.auth.id)';
    users.createRule =
        '@request.auth.id != "" && @request.body.account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    users.updateRule =
        '(id = @request.auth.id && @request.body.account_email:isset = false && @request.body.is_active:isset = false && @request.body.verified:isset = false) || (@request.auth.id != "" && account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin")';
    users.deleteRule =
        '@request.auth.id != "" && account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    app.save(users);

    const userRoles = app.findCollectionByNameOrId("user_roles");
    if (!userRoles.fields.find((f) => f.name === "account_email")) {
        userRoles.fields.add(
            new TextField({
                name: "account_email",
                required: false,
            })
        );
    }
    userRoles.listRule = '@request.auth.id != "" && (account_email = @request.auth.email || user = @request.auth.id)';
    userRoles.viewRule = '@request.auth.id != "" && (account_email = @request.auth.email || user = @request.auth.id)';
    userRoles.createRule =
        '@request.auth.id != "" && @request.body.account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    userRoles.updateRule =
        '@request.auth.id != "" && account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    userRoles.deleteRule =
        '@request.auth.id != "" && account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    app.save(userRoles);

    // Backfill: each existing user owns its tenant; each role link inherits the user's tenant.
    let userRecords = [];
    try {
        userRecords = app.findRecordsByFilter("users", "id != ''", "", 0, 0);
    } catch { /* empty collection */ }
    for (const u of userRecords) {
        if (!u.getString("account_email")) {
            try {
                u.set("account_email", (u.email() || "").trim().toLowerCase());
                app.save(u);
            } catch { /* keep going */ }
        }
    }
    let roleLinks = [];
    try {
        roleLinks = app.findRecordsByFilter("user_roles", "id != ''", "", 0, 0);
    } catch { /* empty collection */ }
    for (const link of roleLinks) {
        if (link.getString("account_email")) continue;
        try {
            const owner = app.findRecordById("users", link.getString("user"));
            link.set("account_email", (owner.email() || "").trim().toLowerCase());
            app.save(link);
        } catch { /* keep going */ }
    }
}, (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.listRule = '@request.auth.id != ""';
    users.viewRule = '@request.auth.id != ""';
    users.createRule = '@request.auth.id != "" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    users.updateRule =
        '(id = @request.auth.id && @request.body.is_active:isset = false && @request.body.verified:isset = false) || (@request.auth.id != "" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin")';
    users.deleteRule = '@request.auth.id != "" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= "Admin"';
    users.fields.removeByName("account_email");
    app.save(users);

    const userRoles = app.findCollectionByNameOrId("user_roles");
    userRoles.listRule = '@request.auth.id != ""';
    userRoles.viewRule = '@request.auth.id != ""';
    userRoles.fields.removeByName("account_email");
    app.save(userRoles);
});
