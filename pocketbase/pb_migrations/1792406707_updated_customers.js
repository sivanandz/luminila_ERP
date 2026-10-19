/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)",
    "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
    "listRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
    "updateRule": "@request.auth.id != \"\" && account_email = @request.auth.email && @request.body.account_email:isset = false",
    "viewRule": "@request.auth.id != \"\" && account_email = @request.auth.email"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\" && (account_email = \"\" || account_email = \"admin@luminila.local\" || account_email = @request.auth.email)",
    "listRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "updateRule": "@request.auth.id != \"\" && (account_email = \"\" || account_email = \"admin@luminila.local\" || account_email = @request.auth.email)",
    "viewRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)"
  }, collection)

  return app.save(collection)
})
