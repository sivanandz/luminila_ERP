/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4092854851")

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1607014909",
    "max": 0,
    "min": 0,
    "name": "image_data",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4092854851")

  // remove field
  collection.fields.removeById("text1607014909")

  return app.save(collection)
})
