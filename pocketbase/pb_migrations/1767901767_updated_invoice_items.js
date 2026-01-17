/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_904955017")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_711030668",
    "hidden": false,
    "id": "relation2422544196",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "invoice",
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
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1843675174",
    "max": 0,
    "min": 0,
    "name": "description",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(4, new Field({
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
  collection.fields.addAt(5, new Field({
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
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "number3789599758",
    "max": null,
    "min": null,
    "name": "discount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "number2390866550",
    "max": null,
    "min": null,
    "name": "tax",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(8, new Field({
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
  const collection = app.findCollectionByNameOrId("pbc_904955017")

  // remove field
  collection.fields.removeById("relation2422544196")

  // remove field
  collection.fields.removeById("relation4047749037")

  // remove field
  collection.fields.removeById("text1843675174")

  // remove field
  collection.fields.removeById("number2683508278")

  // remove field
  collection.fields.removeById("number1106926802")

  // remove field
  collection.fields.removeById("number3789599758")

  // remove field
  collection.fields.removeById("number2390866550")

  // remove field
  collection.fields.removeById("number3257917790")

  return app.save(collection)
})
