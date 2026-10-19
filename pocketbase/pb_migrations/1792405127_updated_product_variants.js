/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id != \"\" && (account_email = \"\" || account_email = \"admin@luminila.local\" || account_email = @request.auth.email)",
    "updateRule": "@request.auth.id != \"\" && (account_email = \"\" || account_email = \"admin@luminila.local\" || account_email = @request.auth.email)"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // update collection data
  unmarshal({
    "deleteRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "updateRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)"
  }, collection)

  return app.save(collection)
})
