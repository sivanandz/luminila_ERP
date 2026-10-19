/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)",
    "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
    "listRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && product.is_active = true)",
    "updateRule": "@request.auth.id != \"\" && account_email = @request.auth.email && @request.body.account_email:isset = false",
    "viewRule": "(@request.auth.id != \"\" && account_email = @request.auth.email) || (@request.auth.id = \"\" && product.is_active = true)"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\" && (account_email = \"\" || account_email = \"admin@luminila.local\" || account_email = @request.auth.email)",
    "listRule": "",
    "updateRule": "@request.auth.id != \"\" && (account_email = \"\" || account_email = \"admin@luminila.local\" || account_email = @request.auth.email)",
    "viewRule": ""
  }, collection)

  return app.save(collection)
})
