/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2258830327")

  // update field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "number117021307",
    "max": null,
    "min": 0,
    "name": "current_balance",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2258830327")

  // update field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "number117021307",
    "max": null,
    "min": null,
    "name": "current_balance",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
