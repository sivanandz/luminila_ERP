/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2558321696")

  // add field
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text308040339",
    "max": 0,
    "min": 0,
    "name": "discount_type",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(14, new Field({
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
  collection.fields.addAt(15, new Field({
    "hidden": false,
    "id": "number2428879581",
    "max": null,
    "min": null,
    "name": "max_discount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "hidden": false,
    "id": "number2151790338",
    "max": null,
    "min": null,
    "name": "min_purchase",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "hidden": false,
    "id": "number2246859271",
    "max": null,
    "min": null,
    "name": "min_items",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text995586951",
    "max": 0,
    "min": 0,
    "name": "applies_to",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "hidden": false,
    "id": "json1601815646",
    "maxSize": 0,
    "name": "applies_to_ids",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(20, new Field({
    "hidden": false,
    "id": "number4116220830",
    "max": null,
    "min": null,
    "name": "usage_limit",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(21, new Field({
    "hidden": false,
    "id": "number3422008782",
    "max": null,
    "min": null,
    "name": "per_customer_limit",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "hidden": false,
    "id": "date2502384312",
    "max": "",
    "min": "",
    "name": "start_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(23, new Field({
    "hidden": false,
    "id": "date2220669758",
    "max": "",
    "min": "",
    "name": "end_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2558321696")

  // remove field
  collection.fields.removeById("text308040339")

  // remove field
  collection.fields.removeById("text1843675174")

  // remove field
  collection.fields.removeById("number2428879581")

  // remove field
  collection.fields.removeById("number2151790338")

  // remove field
  collection.fields.removeById("number2246859271")

  // remove field
  collection.fields.removeById("text995586951")

  // remove field
  collection.fields.removeById("json1601815646")

  // remove field
  collection.fields.removeById("number4116220830")

  // remove field
  collection.fields.removeById("number3422008782")

  // remove field
  collection.fields.removeById("date2502384312")

  // remove field
  collection.fields.removeById("date2220669758")

  return app.save(collection)
})
