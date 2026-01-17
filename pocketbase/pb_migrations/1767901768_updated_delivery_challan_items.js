/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4234943340")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_3931064958",
    "hidden": false,
    "id": "relation2165716618",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "challan",
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

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4234943340")

  // remove field
  collection.fields.removeById("relation2165716618")

  // remove field
  collection.fields.removeById("relation4047749037")

  // remove field
  collection.fields.removeById("text1843675174")

  // remove field
  collection.fields.removeById("number2683508278")

  return app.save(collection)
})
