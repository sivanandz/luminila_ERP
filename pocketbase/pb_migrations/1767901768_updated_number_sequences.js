/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2215506785")

  // add field
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2477885070",
    "max": 0,
    "min": 0,
    "name": "prefix",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "number2438579514",
    "max": null,
    "min": null,
    "name": "current_number",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "number99885070",
    "max": null,
    "min": null,
    "name": "padding",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2215506785")

  // remove field
  collection.fields.removeById("text2477885070")

  // remove field
  collection.fields.removeById("number2438579514")

  // remove field
  collection.fields.removeById("number99885070")

  return app.save(collection)
})
