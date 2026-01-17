/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4242123432")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role ?= \"6993t907uvfn355\"",
    "deleteRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role ?= \"6993t907uvfn355\"",
    "listRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role ?= \"6993t907uvfn355\"",
    "updateRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role ?= \"6993t907uvfn355\"",
    "viewRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role ?= \"6993t907uvfn355\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4242123432")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": null,
    "updateRule": null,
    "viewRule": null
  }, collection)

  return app.save(collection)
})
