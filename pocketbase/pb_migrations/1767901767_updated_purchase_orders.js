/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1342968361")

  // add field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "date2052627138",
    "max": "",
    "min": "",
    "name": "received_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1342968361")

  // remove field
  collection.fields.removeById("date2052627138")

  return app.save(collection)
})
