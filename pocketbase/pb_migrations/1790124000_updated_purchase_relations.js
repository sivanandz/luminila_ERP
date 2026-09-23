/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const poItemsCol = app.findCollectionByNameOrId("pbc_336616017");
  const grnCol = app.findCollectionByNameOrId("pbc_3431399436");

  // Add purchase_order alias relation to purchase_order_items
  poItemsCol.fields.addAt(2, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_1342968361",
    "hidden": false,
    "id": "relation3366160171",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "purchase_order",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }));
  app.save(poItemsCol);

  // Add purchase_order alias relation to goods_received_notes
  grnCol.fields.addAt(3, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_1342968361",
    "hidden": false,
    "id": "relation34313994361",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "purchase_order",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }));
  app.save(grnCol);
}, (app) => {
  const poItemsCol = app.findCollectionByNameOrId("pbc_336616017");
  const grnCol = app.findCollectionByNameOrId("pbc_3431399436");

  poItemsCol.fields.removeById("relation3366160171");
  app.save(poItemsCol);

  grnCol.fields.removeById("relation34313994361");
  app.save(grnCol);
});
