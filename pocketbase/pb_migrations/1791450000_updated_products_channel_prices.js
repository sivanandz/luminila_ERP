/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4092854851")

  // check if field already exists
  const existingField = collection.fields.find(f => f.name === "channel_prices")
  if (!existingField) {
    collection.fields.addAt(20, new Field({
      "autogeneratePattern": "",
      "hidden": false,
      "id": "json_channel_prices",
      "maxSize": 0,
      "name": "channel_prices",
      "presentable": false,
      "primaryKey": false,
      "required": false,
      "system": false,
      "type": "json"
    }))
    return app.save(collection)
  }
  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4092854851")
  collection.fields.removeById("json_channel_prices")
  return app.save(collection)
})
