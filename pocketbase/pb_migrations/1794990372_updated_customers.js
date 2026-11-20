/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role.name ?= \"Admin\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email) && (@request.auth.id != \"\" && (@request.auth.email = account_email || (@collection.user_roles:auth.user ?= @request.auth.id && (@collection.user_roles:auth.role.name ?= \"Admin\" || @collection.user_roles:auth.role.name ?= \"Manager\" || @collection.user_roles:auth.role.name ?= \"Staff\"))))"
  }, collection)

  return app.save(collection)
})
