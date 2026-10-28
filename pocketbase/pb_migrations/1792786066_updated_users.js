/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.body.account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\"",
    "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\"",
    "listRule": "@request.auth.id != \"\" && (account_email = @request.auth.email || id = @request.auth.id)",
    "updateRule": "(id = @request.auth.id && @request.body.account_email:isset = false && @request.body.is_active:isset = false && @request.body.verified:isset = false) || (@request.auth.id != \"\" && account_email = @request.auth.email && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\")",
    "viewRule": "@request.auth.id != \"\" && (account_email = @request.auth.email || id = @request.auth.id)"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\"",
    "deleteRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\"",
    "listRule": "@request.auth.id != \"\"",
    "updateRule": "(id = @request.auth.id && @request.body.is_active:isset = false && @request.body.verified:isset = false) || (@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\")",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  return app.save(collection)
})
