/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collectionsToAddEmail = [
    'categories',
    'number_sequences',
    'product_attributes',
    'product_attribute_values',
    'loyalty_settings',
    'loyalty_tiers'
  ];

  for (const name of collectionsToAddEmail) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (!col) continue;

      const hasField = col.fields.some(f => f.name === 'account_email');
      if (!hasField) {
        col.fields.add(new Field({
          name: 'account_email',
          type: 'text',
          required: false,
          presentable: false,
          system: false
        }));
      }

      unmarshal({
        listRule: '@request.auth.id != "" && account_email = @request.auth.email',
        viewRule: '@request.auth.id != "" && account_email = @request.auth.email',
        createRule: '@request.auth.id != "" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)',
        updateRule: '@request.auth.id != "" && account_email = @request.auth.email && @request.body.account_email:isset = false',
        deleteRule: '@request.auth.id != "" && account_email = @request.auth.email'
      }, col);

      app.save(col);
    } catch (e) {
      // ignore
    }
  }

  // Enforce strict isolation on products and product_variants (remove unauthenticated storefront leaks)
  for (const name of ['products', 'product_variants']) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (!col) continue;

      unmarshal({
        listRule: '@request.auth.id != "" && account_email = @request.auth.email',
        viewRule: '@request.auth.id != "" && account_email = @request.auth.email',
        createRule: '@request.auth.id != "" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)',
        updateRule: '@request.auth.id != "" && account_email = @request.auth.email && @request.body.account_email:isset = false',
        deleteRule: '@request.auth.id != "" && account_email = @request.auth.email'
      }, col);

      app.save(col);
    } catch (e) {
      // ignore
    }
  }
}, (app) => {
  // rollback
});
