/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3480387934")

  // add field
  collection.fields.addAt(8, new Field({
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
  collection.fields.addAt(9, new Field({
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
  const collection = app.findCollectionByNameOrId("pbc_3480387934")

  // remove field
  collection.fields.removeById("number3789599758")

  // remove field
  collection.fields.removeById("number3257917790")

  return app.save(collection)
})
