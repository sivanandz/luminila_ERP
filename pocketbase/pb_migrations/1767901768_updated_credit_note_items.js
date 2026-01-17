/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3938117941")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_250375204",
    "hidden": false,
    "id": "relation3363783977",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "credit_note",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(2, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_1715963891",
    "hidden": false,
    "id": "relation4047749037",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "variant",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "number2683508278",
    "max": null,
    "min": null,
    "name": "quantity",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "number1106926802",
    "max": null,
    "min": null,
    "name": "unit_price",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "number3257917790",
    "max": null,
    "min": null,
    "name": "total",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3938117941")

  // remove field
  collection.fields.removeById("relation3363783977")

  // remove field
  collection.fields.removeById("relation4047749037")

  // remove field
  collection.fields.removeById("number2683508278")

  // remove field
  collection.fields.removeById("number1106926802")

  // remove field
  collection.fields.removeById("number3257917790")

  return app.save(collection)
})
