/**
 * Migration script for WPA-06 (customers schema drift) and WPA-12 (sales_orders unique index)
 */
import PocketBase from 'pocketbase';
import { spawn, execSync, ChildProcess } from 'child_process';

const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8091';

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

export async function runMigration(externalPb?: PocketBase) {
  let pb = externalPb;
  let pbProc: ChildProcess | null = null;

  try {
    if (!pb) {
      pbProc = spawn('pocketbase/pocketbase.exe', ['serve', '--http', '127.0.0.1:8091', '--dir', 'pocketbase/pb_data'], {
        cwd: process.cwd(),
        stdio: 'ignore',
      });

      const ready = await waitForPB();
      if (!ready) {
        throw new Error('PocketBase failed to start on ' + PB_URL);
      }

      pb = new PocketBase(PB_URL);
      const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
      const adminPass = process.env.PB_ADMIN_PASSWORD || 'password123456';

      try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);
      } catch {
        await (pb as any).admins.authWithPassword(adminEmail, adminPass);
      }
    }

    console.log('[WPA-06 / WPA-12 Migration] Authenticated. Updating schemas...');

    // 1. WPA-06: Add missing fields to customers collection
    {
      const col = await pb.collections.getOne('customers');
      const existing = new Set(col.fields.map((f: any) => f.name));
      const fieldsToAdd = [
        { name: 'billing_address', type: 'text', required: false },
        { name: 'shipping_address', type: 'text', required: false },
        { name: 'city', type: 'text', required: false },
        { name: 'state', type: 'text', required: false },
        { name: 'state_code', type: 'text', required: false },
        { name: 'pincode', type: 'text', required: false },
        { name: 'company_name', type: 'text', required: false },
        { name: 'pan', type: 'text', required: false },
        { name: 'date_of_birth', type: 'text', required: false },
        { name: 'anniversary', type: 'text', required: false },
        { name: 'tags', type: 'json', required: false },
        { name: 'store_credit', type: 'number', required: false },
        { name: 'total_orders', type: 'number', required: false },
        { name: 'preferred_contact', type: 'text', required: false },
        { name: 'opt_in_marketing', type: 'bool', required: false },
        { name: 'source', type: 'text', required: false },
        { name: 'last_purchase_date', type: 'date', required: false },
      ];

      const newFields = [...col.fields];
      let added = 0;
      for (const f of fieldsToAdd) {
        if (!existing.has(f.name)) {
          newFields.push(f);
          added++;
        }
      }

      if (added > 0) {
        console.log(`[WPA-06] Adding ${added} missing CRM fields to 'customers'...`);
        await pb.collections.update(col.id, { fields: newFields });
        console.log("[WPA-06] 'customers' collection updated successfully.");
      } else {
        console.log("[WPA-06] 'customers' collection already has all fields.");
      }
    }

    // 2. WPA-12 & WPA-16: Ensure sales_orders has unique index on order_number and payment_status field
    {
      const col = await pb.collections.getOne('sales_orders');
      const existing = new Set(col.fields.map((f: any) => f.name));
      const currentIdxs: string[] = col.indexes || [];
      const alreadyHasUnique = currentIdxs.some((idx: string) =>
        idx.includes('sales_orders') && idx.includes('order_number') && idx.toLowerCase().includes('unique')
      );

      const updates: any = {};
      let needsUpdate = false;

      if (!existing.has('payment_status')) {
        console.log("[WPA-16] Adding 'payment_status' field to 'sales_orders'...");
        updates.fields = [...col.fields, { name: 'payment_status', type: 'text', required: false }];
        needsUpdate = true;
      }

      if (!alreadyHasUnique) {
        const uniqueIndexSql = "CREATE UNIQUE INDEX `idx_sales_orders_order_number` ON `sales_orders` (`order_number`) WHERE `order_number` != ''";
        console.log("[WPA-12] Adding unique index to 'sales_orders.order_number'...");
        updates.indexes = [...currentIdxs, uniqueIndexSql];
        needsUpdate = true;
      }

      if (needsUpdate) {
        await pb.collections.update(col.id, updates);
        console.log("[WPA-12 / WPA-16] 'sales_orders' updated successfully.");
      } else {
        console.log("[WPA-12 / WPA-16] 'sales_orders' already has unique index and payment_status.");
      }
    }

    console.log('[WPA-06 / WPA-12 Migration] Completed successfully!');
  } finally {
    if (pbProc) {
      try { pbProc.kill(); } catch {}
      try {
        execSync('powershell -Command "Get-NetTCPConnection -LocalPort 8091 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"', { stdio: 'ignore' });
      } catch {}
    }
  }
}

if (process.argv[1]?.endsWith('migrate-wpa06-wpa12.ts')) {
  runMigration().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
