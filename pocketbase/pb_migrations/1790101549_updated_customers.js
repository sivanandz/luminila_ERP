/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // add field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "select3629118302",
    "maxSelect": 1,
    "name": "customer_type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "retail",
      "wholesale",
      "vip"
    ]
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "hidden": false,
    "id": "bool3475345526",
    "name": "whatsapp_opt_out",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // remove field
  collection.fields.removeById("select3629118302")

  // remove field
  collection.fields.removeById("bool3475345526")

  return app.save(collection)
})
