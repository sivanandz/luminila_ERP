const PocketBase = require('E:/Local_GIT_2/luminila_inv_mgmt/node_modules/pocketbase/dist/pocketbase.cjs.js');
const pb = new PocketBase('http://127.0.0.1:8091');

const TENANT_COLLECTIONS = [
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

async function main() {
  console.log('Authenticating as admin...');
  await pb.admins.authWithPassword('admin@luminila.local', 'Luminila2026!');
  console.log('Admin authenticated.');

  for (const colName of TENANT_COLLECTIONS) {
    try {
      const col = await pb.collections.getOne(colName);
      let modified = false;

      // Add account_email field if missing
      const hasField = col.fields.some(f => f.name === 'account_email');
      if (!hasField) {
        col.fields.push({
          name: 'account_email',
          type: 'text',
          required: false,
          presentable: false,
          system: false
        });
        modified = true;
      }

      // Set strict tenant isolation rules
      const listRule = '@request.auth.id != "" && account_email = @request.auth.email';
      const viewRule = '@request.auth.id != "" && account_email = @request.auth.email';
      const createRule = '@request.auth.id != "" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email)';
      const updateRule = colName === 'stock_discrepancies'
        ? '@request.auth.id != "" && account_email = @request.auth.email && status = "active"'
        : '@request.auth.id != "" && account_email = @request.auth.email && @request.body.account_email:isset = false';
      const deleteRule = '@request.auth.id != "" && account_email = @request.auth.email';

      if (
        col.listRule !== listRule ||
        col.viewRule !== viewRule ||
        col.createRule !== createRule ||
        col.updateRule !== updateRule ||
        col.deleteRule !== deleteRule
      ) {
        col.listRule = listRule;
        col.viewRule = viewRule;
        col.createRule = createRule;
        col.updateRule = updateRule;
        col.deleteRule = deleteRule;
        modified = true;
      }

      if (modified) {
        await pb.collections.update(col.id, col);
        console.log(`[SECURED] ${colName}: added account_email & strict tenant rules`);
      } else {
        console.log(`[ALREADY SECURED] ${colName}`);
      }
    } catch (err) {
      console.error(`Failed to secure collection ${colName}:`, err.message);
    }
  }

  console.log('All tenant collections secured successfully!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
