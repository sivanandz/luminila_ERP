/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3471998555")

  // update collection data
  unmarshal({
    "deleteRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "listRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "updateRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "viewRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)"
  }, collection)

  // add field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3508380933",
    "max": 0,
    "min": 0,
    "name": "account_email",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3471998555")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id != \"\"",
    "listRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  // remove field
  collection.fields.removeById("text3508380933")

  return app.save(collection)
})
