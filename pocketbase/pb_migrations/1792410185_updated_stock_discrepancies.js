/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_493924462")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)",
    "deleteRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
    "listRule": "@request.auth.id != \"\" && account_email = @request.auth.email",
    "updateRule": "@request.auth.id != \"\" && account_email = @request.auth.email && status = \"active\"",
    "viewRule": "@request.auth.id != \"\" && account_email = @request.auth.email"
  }, collection)

  // add field
  collection.fields.addAt(18, new Field({
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
  const collection = app.findCollectionByNameOrId("pbc_493924462")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\"",
    "listRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\" && status = \"active\"",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  // remove field
  collection.fields.removeById("text3508380933")

  return app.save(collection)
})
