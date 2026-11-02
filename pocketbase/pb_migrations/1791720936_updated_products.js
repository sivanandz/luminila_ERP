/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4092854851")

  // A fresh database can already have channel_prices from an earlier schema
  // snapshot; adding it twice aborts `migrate up` and blocks provisioning.
  if (!collection.fields.find((field) => field.name === "channel_prices")) {
    collection.fields.add(new Field({
      "hidden": false,
      "id": "json447239975",
      "maxSize": 0,
      "name": "channel_prices",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "json"
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4092854851")

  // remove field
  collection.fields.removeById("json447239975")

  return app.save(collection)
})
