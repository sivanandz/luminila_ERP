/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4234943340")

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3544843437",
    "max": 0,
    "min": 0,
    "name": "product",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number4176828024",
    "max": null,
    "min": null,
    "name": "sr_no",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1698723685",
    "max": 0,
    "min": 0,
    "name": "hsn_code",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3703245907",
    "max": 0,
    "min": 0,
    "name": "unit",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "number1106926802",
    "max": null,
    "min": null,
    "name": "unit_price",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "number3067659920",
    "max": null,
    "min": null,
    "name": "taxable_value",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "number3067366293",
    "max": null,
    "min": null,
    "name": "gst_rate",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "hidden": false,
    "id": "number1343307059",
    "max": null,
    "min": null,
    "name": "cgst_rate",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "hidden": false,
    "id": "number2587915801",
    "max": null,
    "min": null,
    "name": "cgst_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "hidden": false,
    "id": "number4241588034",
    "max": null,
    "min": null,
    "name": "sgst_rate",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "hidden": false,
    "id": "number884388562",
    "max": null,
    "min": null,
    "name": "sgst_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "hidden": false,
    "id": "number3309287341",
    "max": null,
    "min": null,
    "name": "igst_rate",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "hidden": false,
    "id": "number2028940957",
    "max": null,
    "min": null,
    "name": "igst_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(20, new Field({
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

  // add field
  collection.fields.addAt(21, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1156222427",
    "max": 0,
    "min": 0,
    "name": "remarks",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4234943340")

  // remove field
  collection.fields.removeById("text3544843437")

  // remove field
  collection.fields.removeById("number4176828024")

  // remove field
  collection.fields.removeById("text1698723685")

  // remove field
  collection.fields.removeById("text3703245907")

  // remove field
  collection.fields.removeById("number1106926802")

  // remove field
  collection.fields.removeById("number3067659920")

  // remove field
  collection.fields.removeById("number3067366293")

  // remove field
  collection.fields.removeById("number1343307059")

  // remove field
  collection.fields.removeById("number2587915801")

  // remove field
  collection.fields.removeById("number4241588034")

  // remove field
  collection.fields.removeById("number884388562")

  // remove field
  collection.fields.removeById("number3309287341")

  // remove field
  collection.fields.removeById("number2028940957")

  // remove field
  collection.fields.removeById("number3257917790")

  // remove field
  collection.fields.removeById("text1156222427")

  return app.save(collection)
})
