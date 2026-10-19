/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // 1. Allow public storefront & multi-tenant catalog reading on products
  const products = app.findCollectionByNameOrId("pbc_4092854851");
  unmarshal({
    "listRule": "is_active = true || (@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"\" && @request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "viewRule": "is_active = true || (@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"\" && @request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)"
  }, products);
  app.save(products);

  // 2. Allow public storefront inventory & variant stock reads
  const variants = app.findCollectionByNameOrId("pbc_1715963891");
  unmarshal({
    "listRule": "",
    "viewRule": ""
  }, variants);
  app.save(variants);

  // 3. Allow public storefront category hierarchy navigation
  const categories = app.findCollectionByNameOrId("pbc_3292755704");
  unmarshal({
    "listRule": "",
    "viewRule": ""
  }, categories);
  return app.save(categories);
}, (app) => {
  const products = app.findCollectionByNameOrId("pbc_4092854851");
  unmarshal({
    "listRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "viewRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)"
  }, products);
  app.save(products);

  const variants = app.findCollectionByNameOrId("pbc_1715963891");
  unmarshal({
    "listRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)",
    "viewRule": "(@request.auth.email = \"admin@luminila.local\" && (account_email = \"\" || account_email = \"admin@luminila.local\")) || (@request.auth.email != \"admin@luminila.local\" && account_email = @request.auth.email)"
  }, variants);
  app.save(variants);

  const categories = app.findCollectionByNameOrId("pbc_3292755704");
  unmarshal({
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  }, categories);
  return app.save(categories);
});
