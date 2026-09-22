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
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text446329125",
        "max": 0,
        "min": 0,
        "name": "chat_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select2753680854",
        "maxSelect": 1,
        "name": "contact_type",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": [
          "customer",
          "vendor",
          "lead"
        ]
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text1994194169",
        "max": 0,
        "min": 0,
        "name": "contact_name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_108570809",
        "hidden": false,
        "id": "relation2168032777",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "customer",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_3732325883",
        "hidden": false,
        "id": "relation4112659446",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "vendor",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text2076961343",
        "max": 0,
        "min": 0,
        "name": "last_message_body",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "date3489102280",
        "max": "",
        "min": "",
        "name": "last_message_time",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      },
      {
        "hidden": false,
        "id": "number4232961397",
        "max": null,
        "min": null,
        "name": "unread_count",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
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
          "active",
          "archived",
          "pending_quote"
        ]
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "hidden": false,
        "id": "relation2263269840",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "assigned_staff",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "json3050373649",
        "maxSize": 0,
        "name": "labels",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }
    ],
    "id": "pbc_3502416391",
    "indexes": [
      "CREATE UNIQUE INDEX idx_wa_chats_chat_id ON whatsapp_chats (chat_id)"
    ],
    "listRule": "",
    "name": "whatsapp_chats",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3502416391");

  return app.delete(collection);
})
