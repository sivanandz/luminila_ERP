/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const tenantCollections = [
    'stock_discrepancies',
    'vendors',
    'vendor_products',
    'purchase_orders',
    'purchase_order_items',
    'goods_received_notes',
    'grn_items',
    'invoices',
    'invoice_items',
    'invoice_payments',
    'credit_notes',
    'credit_note_items',
    'expenses',
    'expense_categories',
    'bank_accounts',
    'bank_transactions',
    'delivery_challans',
    'delivery_challan_items',
    'payment_links',
    'whatsapp_chats',
    'whatsapp_messages',
    'broadcast_messages',
    'whatsapp_opt_outs',
    'label_print_queue',
    'activity_logs',
    'cash_register_shifts',
    'cash_drawer_operations',
    'loyalty_accounts',
    'loyalty_transactions',
    'discounts',
    'discount_usage',
    'customer_interactions'
  ];

  for (const name of tenantCollections) {
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

      const updateRule = name === 'stock_discrepancies'
        ? '@request.auth.id != "" && account_email = @request.auth.email && status = "active"'
        : '@request.auth.id != "" && account_email = @request.auth.email && @request.body.account_email:isset = false';

      unmarshal({
        listRule: '@request.auth.id != "" && account_email = @request.auth.email',
        viewRule: '@request.auth.id != "" && account_email = @request.auth.email',
        createRule: '@request.auth.id != "" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)',
        updateRule: updateRule,
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
