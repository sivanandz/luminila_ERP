/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3086804294")

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "number389218067",
    "max": null,
    "min": null,
    "name": "balance_after",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3725765462",
    "max": 0,
    "min": 0,
    "name": "created_by",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3086804294")

  // remove field
  collection.fields.removeById("number389218067")

  // remove field
  collection.fields.removeById("text3725765462")

  return app.save(collection)
})
