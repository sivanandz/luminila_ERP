/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
    "viewRule": "@request.auth.id != \"\" && account_email = @request.auth.email"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // update collection data
  unmarshal({
    "listRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && product.is_active = true)",
    "viewRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && product.is_active = true)"
  }, collection)

  return app.save(collection)
})
