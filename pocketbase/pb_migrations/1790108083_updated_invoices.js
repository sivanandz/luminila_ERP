/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_711030668")

  // add field
  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2038371506",
    "max": 0,
    "min": 0,
    "name": "seller_gstin",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(21, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1557838822",
    "max": 0,
    "min": 0,
    "name": "seller_name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3594573456",
    "max": 0,
    "min": 0,
    "name": "seller_address",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(23, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text749553716",
    "max": 0,
    "min": 0,
    "name": "seller_state_code",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(24, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1710458514",
    "max": 0,
    "min": 0,
    "name": "buyer_name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(25, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text774801578",
    "max": 0,
    "min": 0,
    "name": "buyer_gstin",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(26, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3004567672",
    "max": 0,
    "min": 0,
    "name": "buyer_phone",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(27, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text281803729",
    "max": 0,
    "min": 0,
    "name": "buyer_email",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(28, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2917320439",
    "max": 0,
    "min": 0,
    "name": "buyer_address",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(29, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text321865087",
    "max": 0,
    "min": 0,
    "name": "buyer_state_code",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(30, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2978666219",
    "max": 0,
    "min": 0,
    "name": "place_of_supply",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(31, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2697449135",
    "hidden": false,
    "id": "relation3846946821",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "sale",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(32, new Field({
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
  collection.fields.addAt(33, new Field({
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
  collection.fields.addAt(34, new Field({
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
  collection.fields.addAt(35, new Field({
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
  collection.fields.addAt(36, new Field({
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
  collection.fields.addAt(37, new Field({
    "hidden": false,
    "id": "number661584507",
    "max": null,
    "min": null,
    "name": "total_tax",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(38, new Field({
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
  collection.fields.addAt(39, new Field({
    "hidden": false,
    "id": "number3701954270",
    "max": null,
    "min": null,
    "name": "shipping_charges",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(40, new Field({
    "hidden": false,
    "id": "number3900802059",
    "max": null,
    "min": null,
    "name": "grand_total",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(41, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2350535409",
    "max": 0,
    "min": 0,
    "name": "amount_in_words",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(42, new Field({
    "hidden": false,
    "id": "bool2542246466",
    "name": "is_reverse_charge",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(43, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1243222062",
    "max": 0,
    "min": 0,
    "name": "transport_mode",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(44, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1062084231",
    "max": 0,
    "min": 0,
    "name": "vehicle_number",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(45, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3756722627",
    "max": 0,
    "min": 0,
    "name": "payment_terms",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(46, new Field({
    "hidden": false,
    "id": "bool1753056537",
    "name": "is_paid",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_711030668")

  // remove field
  collection.fields.removeById("text2038371506")

  // remove field
  collection.fields.removeById("text1557838822")

  // remove field
  collection.fields.removeById("text3594573456")

  // remove field
  collection.fields.removeById("text749553716")

  // remove field
  collection.fields.removeById("text1710458514")

  // remove field
  collection.fields.removeById("text774801578")

  // remove field
  collection.fields.removeById("text3004567672")

  // remove field
  collection.fields.removeById("text281803729")

  // remove field
  collection.fields.removeById("text2917320439")

  // remove field
  collection.fields.removeById("text321865087")

  // remove field
  collection.fields.removeById("text2978666219")

  // remove field
  collection.fields.removeById("relation3846946821")

  // remove field
  collection.fields.removeById("number3067659920")

  // remove field
  collection.fields.removeById("number2587915801")

  // remove field
  collection.fields.removeById("number884388562")

  // remove field
  collection.fields.removeById("number2028940957")

  // remove field
  collection.fields.removeById("number2490412861")

  // remove field
  collection.fields.removeById("number661584507")

  // remove field
  collection.fields.removeById("number3772865661")

  // remove field
  collection.fields.removeById("number3701954270")

  // remove field
  collection.fields.removeById("number3900802059")

  // remove field
  collection.fields.removeById("text2350535409")

  // remove field
  collection.fields.removeById("bool2542246466")

  // remove field
  collection.fields.removeById("text1243222062")

  // remove field
  collection.fields.removeById("text1062084231")

  // remove field
  collection.fields.removeById("text3756722627")

  // remove field
  collection.fields.removeById("bool1753056537")

  return app.save(collection)
})
