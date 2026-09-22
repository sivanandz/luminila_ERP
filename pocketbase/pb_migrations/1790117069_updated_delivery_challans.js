/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3931064958")

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "date3818798823",
    "max": "",
    "min": "",
    "name": "challan_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3319684788",
    "max": 0,
    "min": 0,
    "name": "challan_type",
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
    "id": "text2156285730",
    "max": 0,
    "min": 0,
    "name": "consignor_name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3853143791",
    "max": 0,
    "min": 0,
    "name": "consignor_gstin",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1391186358",
    "max": 0,
    "min": 0,
    "name": "consignor_address",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text505978437",
    "max": 0,
    "min": 0,
    "name": "consignor_state_code",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2312856982",
    "max": 0,
    "min": 0,
    "name": "consignee",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text975512143",
    "max": 0,
    "min": 0,
    "name": "consignee_name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3591630951",
    "max": 0,
    "min": 0,
    "name": "consignee_gstin",
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
    "id": "text2372431559",
    "max": 0,
    "min": 0,
    "name": "consignee_address",
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
    "id": "text1559755792",
    "max": 0,
    "min": 0,
    "name": "consignee_state_code",
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
  collection.fields.addAt(24, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text57483822",
    "max": 0,
    "min": 0,
    "name": "sales_order",
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
    "id": "text2422544196",
    "max": 0,
    "min": 0,
    "name": "invoice",
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
    "id": "text2380561404",
    "max": 0,
    "min": 0,
    "name": "transporter_name",
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
  collection.fields.addAt(28, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3124032402",
    "max": 0,
    "min": 0,
    "name": "eway_bill_number",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(29, new Field({
    "hidden": false,
    "id": "date3746380021",
    "max": "",
    "min": "",
    "name": "eway_bill_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(30, new Field({
    "hidden": false,
    "id": "number554441351",
    "max": null,
    "min": null,
    "name": "total_quantity",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(31, new Field({
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
  collection.fields.addAt(32, new Field({
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
  collection.fields.addAt(33, new Field({
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
  collection.fields.addAt(34, new Field({
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
  collection.fields.addAt(35, new Field({
    "hidden": false,
    "id": "number3724922374",
    "max": null,
    "min": null,
    "name": "total_value",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(36, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1001949196",
    "max": 0,
    "min": 0,
    "name": "reason",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(37, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text222379301",
    "max": 0,
    "min": 0,
    "name": "internal_notes",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(38, new Field({
    "hidden": false,
    "id": "date2731049663",
    "max": "",
    "min": "",
    "name": "expected_delivery_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3931064958")

  // remove field
  collection.fields.removeById("date3818798823")

  // remove field
  collection.fields.removeById("text3319684788")

  // remove field
  collection.fields.removeById("text2156285730")

  // remove field
  collection.fields.removeById("text3853143791")

  // remove field
  collection.fields.removeById("text1391186358")

  // remove field
  collection.fields.removeById("text505978437")

  // remove field
  collection.fields.removeById("text2312856982")

  // remove field
  collection.fields.removeById("text975512143")

  // remove field
  collection.fields.removeById("text3591630951")

  // remove field
  collection.fields.removeById("text2372431559")

  // remove field
  collection.fields.removeById("text1559755792")

  // remove field
  collection.fields.removeById("text2978666219")

  // remove field
  collection.fields.removeById("text57483822")

  // remove field
  collection.fields.removeById("text2422544196")

  // remove field
  collection.fields.removeById("text2380561404")

  // remove field
  collection.fields.removeById("text1243222062")

  // remove field
  collection.fields.removeById("text3124032402")

  // remove field
  collection.fields.removeById("date3746380021")

  // remove field
  collection.fields.removeById("number554441351")

  // remove field
  collection.fields.removeById("number3067659920")

  // remove field
  collection.fields.removeById("number2587915801")

  // remove field
  collection.fields.removeById("number884388562")

  // remove field
  collection.fields.removeById("number2028940957")

  // remove field
  collection.fields.removeById("number3724922374")

  // remove field
  collection.fields.removeById("text1001949196")

  // remove field
  collection.fields.removeById("text222379301")

  // remove field
  collection.fields.removeById("date2731049663")

  return app.save(collection)
})
