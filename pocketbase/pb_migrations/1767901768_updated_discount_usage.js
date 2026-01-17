/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3693802352")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2558321696",
    "hidden": false,
    "id": "relation3789599758",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "discount",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(2, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2420370400",
    "hidden": false,
    "id": "relation4113142680",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "order",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_108570809",
    "hidden": false,
    "id": "relation2168032777",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "customer",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "number3605347579",
    "max": null,
    "min": null,
    "name": "amount_saved",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3693802352")

  // remove field
  collection.fields.removeById("relation3789599758")

  // remove field
  collection.fields.removeById("relation4113142680")

  // remove field
  collection.fields.removeById("relation2168032777")

  // remove field
  collection.fields.removeById("number3605347579")

  return app.save(collection)
})
