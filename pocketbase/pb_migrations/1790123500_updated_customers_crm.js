/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // add field: ring_size
  collection.fields.addAt(32, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201911",
    "max": 0,
    "min": 0,
    "name": "ring_size",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field: bangle_size
  collection.fields.addAt(33, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201912",
    "max": 0,
    "min": 0,
    "name": "bangle_size",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field: preferred_metal
  collection.fields.addAt(34, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201913",
    "max": 0,
    "min": 0,
    "name": "preferred_metal",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field: lead_status
  collection.fields.addAt(35, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201914",
    "max": 0,
    "min": 0,
    "name": "lead_status",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field: assigned_staff
  collection.fields.addAt(36, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201915",
    "max": 0,
    "min": 0,
    "name": "assigned_staff",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field: anniversary_date (alias for anniversary)
  collection.fields.addAt(37, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201916",
    "max": 0,
    "min": 0,
    "name": "anniversary_date",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field: birthday_date (alias for date_of_birth)
  collection.fields.addAt(38, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1938201917",
    "max": 0,
    "min": 0,
    "name": "birthday_date",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  collection.fields.removeById("text1938201911")
  collection.fields.removeById("text1938201912")
  collection.fields.removeById("text1938201913")
  collection.fields.removeById("text1938201914")
  collection.fields.removeById("text1938201915")
  collection.fields.removeById("text1938201916")
  collection.fields.removeById("text1938201917")

  return app.save(collection)
})
