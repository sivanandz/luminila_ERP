/**
 * Deep schema & security audit for the full-project bug hunt.
 * Starts PB on :8091, inspects all collections, checks API rule exposure, finds field mismatches.
 */
import PocketBase from 'pocketbase';
import { execSync, spawn, ChildProcess } from 'child_process';

const PB_URL = 'http://127.0.0.1:8091';

async function waitForPB(maxWait = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${PB_URL}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  let pbProcess: ChildProcess | null = null;

  try {
    // Start PocketBase
    pbProcess = spawn('pocketbase/pocketbase.exe', ['serve', '--http', '127.0.0.1:8091', '--dir', 'pocketbase/pb_data'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });

    const ready = await waitForPB();
    if (!ready) { console.error('PB failed to start'); process.exit(1); }

    const pb = new PocketBase(PB_URL);
    await pb.collection('_superusers').authWithPassword('admin@luminila.com', 'password123456');

    const collections = await pb.collections.getFullList();

    const targetCollections = [
      'sales', 'sale_items', 'stock_movements', 'cash_register_shifts',
      'cash_drawer_operations', 'bank_accounts', 'bank_transactions',
      'payment_links', 'loyalty_transactions', 'sales_orders',
      'sales_order_items', 'product_variants', 'products', 'customers',
      'vendors', 'activity_logs', 'delivery_challans', 'delivery_challan_items',
      'invoices', 'invoice_items', 'invoice_payments', 'credit_notes',
      'credit_note_items', 'purchase_orders', 'purchase_order_items',
      'goods_received_notes', 'grn_items', 'expenses', 'number_sequences',
      'settings', 'whatsapp_sessions', 'crm_contacts', 'crm_interactions',
      'discount_rules', 'loyalty_tiers', 'roles', 'user_roles'
    ];

    console.log(`\n=== SCHEMA & SECURITY AUDIT (${collections.length} total collections) ===\n`);

    const findings: string[] = [];

    for (const name of targetCollections) {
      const col = collections.find((c: any) => c.name === name);
      if (!col) {
        findings.push(`MISSING_COLLECTION: ${name} — referenced in code but does not exist in PocketBase`);
        console.log(`❌ MISSING: ${name}`);
        continue;
      }

      const fields = (col as any).fields
        ?.filter((f: any) => !['id', 'created', 'updated'].includes(f.name))
        ?.map((f: any) => {
          let info = `${f.name}(${f.type}`;
          if (f.required) info += ',REQ';
          if (f.type === 'relation' && f.collectionId) info += `,→${f.collectionId}`;
          info += ')';
          return info;
        }) || [];

      // Check API rules
      const rules: Record<string, any> = {
        list: (col as any).listRule,
        view: (col as any).viewRule,
        create: (col as any).createRule,
        update: (col as any).updateRule,
        delete: (col as any).deleteRule,
      };
      
      const openRules = Object.entries(rules)
        .filter(([, v]) => v === '' || v === null)
        .map(([k]) => k);

      if (openRules.length > 0) {
        const nullRules = Object.entries(rules).filter(([, v]) => v === null).map(([k]) => k);
        const emptyRules = Object.entries(rules).filter(([, v]) => v === '').map(([k]) => k);
        
        if (nullRules.includes('delete')) {
          findings.push(`OPEN_DELETE: ${name} — delete rule is NULL (completely open to public)`);
        }
        if (nullRules.includes('create')) {
          findings.push(`OPEN_CREATE: ${name} — create rule is NULL (anyone can create records)`);
        }
        if (emptyRules.includes('delete') && !['activity_logs'].includes(name)) {
          findings.push(`OPEN_DELETE_EMPTY: ${name} — delete rule is empty string (open to all auth users)`);
        }
      }

      const ruleIcon = openRules.length > 0 ? `⚠️ OPEN:[${openRules.join(',')}]` : '🔒';
      console.log(`📦 ${name} ${ruleIcon}`);
      console.log(`   ${fields.join(', ')}`);
      console.log('');
    }

    // Extra collections not in target list
    const extraCollections = collections
      .filter((c: any) => !targetCollections.includes(c.name) && !c.name.startsWith('_') && !c.name.startsWith('pb_'))
      .map((c: any) => c.name);
    if (extraCollections.length > 0) {
      console.log(`\n🔍 UNLISTED COLLECTIONS: ${extraCollections.join(', ')}`);
    }

    // Print findings summary
    if (findings.length > 0) {
      console.log(`\n=== ${findings.length} FINDINGS ===`);
      findings.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
    } else {
      console.log('\n✅ No critical findings.');
    }

  } finally {
    // Kill PocketBase
    if (pbProcess) { try { pbProcess.kill(); } catch {} }
    try {
      execSync('powershell -Command "Get-NetTCPConnection -LocalPort 8091 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"', { stdio: 'ignore' });
    } catch {}
  }
}

main().catch(console.error);
