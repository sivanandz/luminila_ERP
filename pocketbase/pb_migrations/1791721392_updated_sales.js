/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2697449135")

  // update field
  collection.fields.addAt(1, new Field({
    "hidden": false,
    "id": "select2734263879",
    "maxSelect": 1,
    "name": "channel",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "pos",
      "shopify",
      "whatsapp",
      "wholesale",
      "exhibition",
      "marketplace",
      "woocommerce",
      "other"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2697449135")

  // update field
  collection.fields.addAt(1, new Field({
    "hidden": false,
    "id": "select2734263879",
    "maxSelect": 1,
    "name": "channel",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "pos",
      "shopify",
      "whatsapp"
    ]
  }))

  return app.save(collection)
})
