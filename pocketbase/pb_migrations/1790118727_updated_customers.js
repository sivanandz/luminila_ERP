/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // add field
  collection.fields.addAt(15, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1717625942",
    "max": 0,
    "min": 0,
    "name": "billing_address",
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
    "id": "text3943065925",
    "max": 0,
    "min": 0,
    "name": "shipping_address",
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
    "id": "text760939060",
    "max": 0,
    "min": 0,
    "name": "city",
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
    "id": "text2744374011",
    "max": 0,
    "min": 0,
    "name": "state",
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
    "id": "text3824597342",
    "max": 0,
    "min": 0,
    "name": "state_code",
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
    "id": "text783054703",
    "max": 0,
    "min": 0,
    "name": "pincode",
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
    "id": "text491676904",
    "max": 0,
    "min": 0,
    "name": "company_name",
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
    "id": "text2103224315",
    "max": 0,
    "min": 0,
    "name": "pan",
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
    "id": "text1089581607",
    "max": 0,
    "min": 0,
    "name": "date_of_birth",
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
    "id": "text1042979247",
    "max": 0,
    "min": 0,
    "name": "anniversary",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(25, new Field({
    "hidden": false,
    "id": "json1874629670",
    "maxSize": 0,
    "name": "tags",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(26, new Field({
    "hidden": false,
    "id": "number2027354216",
    "max": null,
    "min": null,
    "name": "store_credit",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(27, new Field({
    "hidden": false,
    "id": "number758898424",
    "max": null,
    "min": null,
    "name": "total_orders",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(28, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3868314855",
    "max": 0,
    "min": 0,
    "name": "preferred_contact",
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
    "id": "bool230418170",
    "name": "opt_in_marketing",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(30, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1602912115",
    "max": 0,
    "min": 0,
    "name": "source",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(31, new Field({
    "hidden": false,
    "id": "date3055721614",
    "max": "",
    "min": "",
    "name": "last_purchase_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // remove field
  collection.fields.removeById("text1717625942")

  // remove field
  collection.fields.removeById("text3943065925")

  // remove field
  collection.fields.removeById("text760939060")

  // remove field
  collection.fields.removeById("text2744374011")

  // remove field
  collection.fields.removeById("text3824597342")

  // remove field
  collection.fields.removeById("text783054703")

  // remove field
  collection.fields.removeById("text491676904")

  // remove field
  collection.fields.removeById("text2103224315")

  // remove field
  collection.fields.removeById("text1089581607")

  // remove field
  collection.fields.removeById("text1042979247")

  // remove field
  collection.fields.removeById("json1874629670")

  // remove field
  collection.fields.removeById("number2027354216")

  // remove field
  collection.fields.removeById("number758898424")

  // remove field
  collection.fields.removeById("text3868314855")

  // remove field
  collection.fields.removeById("bool230418170")

  // remove field
  collection.fields.removeById("text1602912115")

  // remove field
  collection.fields.removeById("date3055721614")

  return app.save(collection)
})
