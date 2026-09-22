/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_904955017")

  // add field
  collection.fields.addAt(11, new Field({
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
  collection.fields.addAt(12, new Field({
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
  collection.fields.addAt(13, new Field({
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
  collection.fields.addAt(14, new Field({
    "hidden": false,
    "id": "number3619613992",
    "max": null,
    "min": null,
    "name": "discount_percent",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "hidden": false,
    "id": "number3772865661",
    "max": null,
    "min": null,
    "name": "discount_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "hidden": false,
    "id": "number1605482541",
    "max": null,
    "min": null,
    "name": "taxable_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(17, new Field({
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
  collection.fields.addAt(18, new Field({
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
  collection.fields.addAt(19, new Field({
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
  collection.fields.addAt(20, new Field({
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
  collection.fields.addAt(21, new Field({
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
  collection.fields.addAt(22, new Field({
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
  collection.fields.addAt(23, new Field({
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
  collection.fields.addAt(24, new Field({
    "hidden": false,
    "id": "number254872310",
    "max": null,
    "min": null,
    "name": "cess_rate",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(25, new Field({
    "hidden": false,
    "id": "number2490412861",
    "max": null,
    "min": null,
    "name": "cess_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(26, new Field({
    "hidden": false,
    "id": "number1186288468",
    "max": null,
    "min": null,
    "name": "total_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_904955017")

  // remove field
  collection.fields.removeById("number4176828024")

  // remove field
  collection.fields.removeById("text1698723685")

  // remove field
  collection.fields.removeById("text3703245907")

  // remove field
  collection.fields.removeById("number3619613992")

  // remove field
  collection.fields.removeById("number3772865661")

  // remove field
  collection.fields.removeById("number1605482541")

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
  collection.fields.removeById("number254872310")

  // remove field
  collection.fields.removeById("number2490412861")

  // remove field
  collection.fields.removeById("number1186288468")

  return app.save(collection)
})
