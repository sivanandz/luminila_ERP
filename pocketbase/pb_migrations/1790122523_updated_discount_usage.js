/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3693802352")

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "number3772865661",
    "max": null,
    "min": null,
    "name": "discount_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number2666081481",
    "max": null,
    "min": null,
    "name": "order_value",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2697449135",
    "hidden": false,
    "id": "relation3846946821",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "sale",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_711030668",
    "hidden": false,
    "id": "relation2422544196",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "invoice",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3693802352")

  // remove field
  collection.fields.removeById("number3772865661")

  // remove field
  collection.fields.removeById("number2666081481")

  // remove field
  collection.fields.removeById("relation3846946821")

  // remove field
  collection.fields.removeById("relation2422544196")

  return app.save(collection)
})
