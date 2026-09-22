/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_314358106")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "number2560536958",
    "max": null,
    "min": null,
    "name": "opening_balance",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(7, new Field({
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
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_314358106")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "number2560536958",
    "max": null,
    "min": null,
    "name": "opening_balance",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "number117021307",
    "max": null,
    "min": null,
    "name": "current_balance",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
