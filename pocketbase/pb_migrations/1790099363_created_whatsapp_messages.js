/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "pbc_3502416391",
        "hidden": false,
        "id": "relation1704850090",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "chat",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text1400509225",
        "max": 0,
        "min": 0,
        "name": "message_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "bool1805986969",
        "name": "from_me",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text2714339541",
        "max": 0,
        "min": 0,
        "name": "sender_name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "hidden": false,
        "id": "relation1873125574",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "staff_user",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3685223346",
        "max": 0,
        "min": 0,
        "name": "body",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select625724656",
        "maxSelect": 1,
        "name": "message_type",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": [
          "text",
          "image",
          "document",
          "product_card",
          "payment_link"
        ]
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3207018323",
        "max": 0,
        "min": 0,
        "name": "media_url",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select2063623452",
        "maxSelect": 1,
        "name": "status",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": [
          "pending",
          "sent",
          "delivered",
          "read",
          "failed"
        ]
      },
      {
        "hidden": false,
        "id": "date2782324286",
        "max": "",
        "min": "",
        "name": "timestamp",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      }
    ],
    "id": "pbc_4248322839",
    "indexes": [
      "CREATE UNIQUE INDEX idx_wa_messages_message_id ON whatsapp_messages (message_id)"
    ],
    "listRule": "",
    "name": "whatsapp_messages",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4248322839");

  return app.delete(collection);
})
