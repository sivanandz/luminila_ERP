/**
 * Migration Script: Apply Schema Extensions for SWEEP-1, SWEEP-2, SWEEP-3, and WPA-05
 * 
 * Remediates:
 * - SWEEP-1 (P0): sales.status add 'delivered', sales.payment_method add 'phonepe'
 * - SWEEP-2 (P1): delivery_challans & delivery_challan_items missing GST/consignor/consignee fields
 * - SWEEP-3 (P1): credit_notes & credit_note_items missing GST reversal breakdown fields
 * - WPA-05 (P2): payment_links lock down open API rules to authenticated users
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

    console.log('[SWEEP Migration] Authenticated. Starting schema updates...');

    // 1. SWEEP-1: Update 'sales' collection status & payment_method selects
    {
      const col = await pb.collections.getOne('sales');
      let modified = false;
      const updatedFields = col.fields.map((f: any) => {
        if (f.name === 'status' && Array.isArray(f.values)) {
          if (!f.values.includes('delivered')) {
            f.values = [...f.values, 'delivered'];
            modified = true;
          }
        }
        if (f.name === 'payment_method' && Array.isArray(f.values)) {
          if (!f.values.includes('phonepe')) {
            f.values = [...f.values, 'phonepe'];
            modified = true;
          }
        }
        return f;
      });

      if (modified) {
        console.log("[SWEEP-1] Updating 'sales' schema with 'delivered' status and 'phonepe' payment_method...");
        await pb.collections.update(col.id, { fields: updatedFields });
        console.log("[SWEEP-1] 'sales' collection updated successfully.");
      } else {
        console.log("[SWEEP-1] 'sales' collection already has required select options.");
      }
    }

    // 1b. Update 'sale_items' collection: make 'product' relation optional if required
    {
      const col = await pb.collections.getOne('sale_items');
      let modified = false;
      const updatedFields = col.fields.map((f: any) => {
        if (f.name === 'product' && f.required) {
          f.required = false;
          modified = true;
        }
        return f;
      });
      if (modified) {
        console.log("[SWEEP-1b] Relaxing 'sale_items.product' required flag to false for custom/variant-only POS lines...");
        await pb.collections.update(col.id, { fields: updatedFields });
      }
    }

    // 2. SWEEP-2: delivery_challans fields
    {
      const col = await pb.collections.getOne('delivery_challans');
      const existing = new Set(col.fields.map((f: any) => f.name));
      const fieldsToAdd = [
        { name: 'challan_date', type: 'date', required: false },
        { name: 'challan_type', type: 'text', required: false },
        { name: 'consignor_name', type: 'text', required: false },
        { name: 'consignor_gstin', type: 'text', required: false },
        { name: 'consignor_address', type: 'text', required: false },
        { name: 'consignor_state_code', type: 'text', required: false },
        { name: 'consignee', type: 'text', required: false },
        { name: 'consignee_name', type: 'text', required: false },
        { name: 'consignee_gstin', type: 'text', required: false },
        { name: 'consignee_address', type: 'text', required: false },
        { name: 'consignee_state_code', type: 'text', required: false },
        { name: 'place_of_supply', type: 'text', required: false },
        { name: 'sales_order', type: 'text', required: false },
        { name: 'invoice', type: 'text', required: false },
        { name: 'transporter_name', type: 'text', required: false },
        { name: 'transport_mode', type: 'text', required: false },
        { name: 'eway_bill_number', type: 'text', required: false },
        { name: 'eway_bill_date', type: 'date', required: false },
        { name: 'total_quantity', type: 'number', required: false },
        { name: 'taxable_value', type: 'number', required: false },
        { name: 'cgst_amount', type: 'number', required: false },
        { name: 'sgst_amount', type: 'number', required: false },
        { name: 'igst_amount', type: 'number', required: false },
        { name: 'total_value', type: 'number', required: false },
        { name: 'reason', type: 'text', required: false },
        { name: 'internal_notes', type: 'text', required: false },
        { name: 'expected_delivery_date', type: 'date', required: false },
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
        console.log(`[SWEEP-2] Adding ${added} missing fields to 'delivery_challans'...`);
        await pb.collections.update(col.id, { fields: newFields });
        console.log("[SWEEP-2] 'delivery_challans' updated.");
      } else {
        console.log("[SWEEP-2] 'delivery_challans' already has all fields.");
      }
    }

    // 2b. delivery_challan_items fields
    {
      const col = await pb.collections.getOne('delivery_challan_items');
      const existing = new Set(col.fields.map((f: any) => f.name));
      const fieldsToAdd = [
        { name: 'product', type: 'text', required: false },
        { name: 'sr_no', type: 'number', required: false },
        { name: 'hsn_code', type: 'text', required: false },
        { name: 'unit', type: 'text', required: false },
        { name: 'unit_price', type: 'number', required: false },
        { name: 'taxable_value', type: 'number', required: false },
        { name: 'gst_rate', type: 'number', required: false },
        { name: 'cgst_rate', type: 'number', required: false },
        { name: 'cgst_amount', type: 'number', required: false },
        { name: 'sgst_rate', type: 'number', required: false },
        { name: 'sgst_amount', type: 'number', required: false },
        { name: 'igst_rate', type: 'number', required: false },
        { name: 'igst_amount', type: 'number', required: false },
        { name: 'total', type: 'number', required: false },
        { name: 'remarks', type: 'text', required: false },
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
        console.log(`[SWEEP-2b] Adding ${added} missing fields to 'delivery_challan_items'...`);
        await pb.collections.update(col.id, { fields: newFields });
        console.log("[SWEEP-2b] 'delivery_challan_items' updated.");
      } else {
        console.log("[SWEEP-2b] 'delivery_challan_items' already has all fields.");
      }
    }

    // 3. SWEEP-3: credit_notes fields
    {
      const col = await pb.collections.getOne('credit_notes');
      const existing = new Set(col.fields.map((f: any) => f.name));
      const fieldsToAdd = [
        { name: 'original_invoice', type: 'text', required: false },
        { name: 'original_sale', type: 'text', required: false },
        { name: 'return_reason', type: 'text', required: false },
        { name: 'buyer_name', type: 'text', required: false },
        { name: 'buyer_address', type: 'text', required: false },
        { name: 'buyer_gstin', type: 'text', required: false },
        { name: 'buyer_state_code', type: 'text', required: false },
        { name: 'taxable_value', type: 'number', required: false },
        { name: 'cgst_amount', type: 'number', required: false },
        { name: 'sgst_amount', type: 'number', required: false },
        { name: 'igst_amount', type: 'number', required: false },
        { name: 'total_tax', type: 'number', required: false },
        { name: 'grand_total', type: 'number', required: false },
        { name: 'refund_method', type: 'text', required: false },
        { name: 'refund_reference', type: 'text', required: false },
        { name: 'refunded_at', type: 'date', required: false },
      ];

      // Also ensure 'amount' is not strictly required if code uses grand_total
      const newFields = col.fields.map((f: any) => {
        if (f.name === 'amount' && f.required) {
          f.required = false;
        }
        return f;
      });

      let added = 0;
      for (const f of fieldsToAdd) {
        if (!existing.has(f.name)) {
          newFields.push(f);
          added++;
        }
      }

      if (added > 0) {
        console.log(`[SWEEP-3] Adding ${added} missing fields to 'credit_notes'...`);
        await pb.collections.update(col.id, { fields: newFields });
        console.log("[SWEEP-3] 'credit_notes' updated.");
      } else {
        console.log("[SWEEP-3] 'credit_notes' already has all fields.");
      }
    }

    // 3b. credit_note_items fields
    {
      const col = await pb.collections.getOne('credit_note_items');
      const existing = new Set(col.fields.map((f: any) => f.name));
      const fieldsToAdd = [
        { name: 'original_invoice_item', type: 'text', required: false },
        { name: 'description', type: 'text', required: false },
        { name: 'hsn_code', type: 'text', required: false },
        { name: 'discount_percent', type: 'number', required: false },
        { name: 'discount_amount', type: 'number', required: false },
        { name: 'taxable_amount', type: 'number', required: false },
        { name: 'gst_rate', type: 'number', required: false },
        { name: 'cgst_amount', type: 'number', required: false },
        { name: 'sgst_amount', type: 'number', required: false },
        { name: 'igst_amount', type: 'number', required: false },
        { name: 'total_amount', type: 'number', required: false },
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
        console.log(`[SWEEP-3b] Adding ${added} missing fields to 'credit_note_items'...`);
        await pb.collections.update(col.id, { fields: newFields });
        console.log("[SWEEP-3b] 'credit_note_items' updated.");
      } else {
        console.log("[SWEEP-3b] 'credit_note_items' already has all fields.");
      }
    }

    // 4. WPA-05: payment_links API rules lockdown
    {
      const col = await pb.collections.getOne('payment_links');
      const authRule = '@request.auth.id != ""';
      if (col.listRule === '' || col.viewRule === '' || col.createRule === '' || col.updateRule === '' || col.deleteRule === '') {
        console.log("[WPA-05] Locking down 'payment_links' API rules to authenticated users...");
        await pb.collections.update(col.id, {
          listRule: authRule,
          viewRule: authRule,
          createRule: authRule,
          updateRule: authRule,
          deleteRule: authRule,
        });
        console.log("[WPA-05] 'payment_links' API rules secured.");
      } else {
        console.log("[WPA-05] 'payment_links' API rules already secured.");
      }
    }

    console.log('[SWEEP Migration] Completed successfully!');
  } finally {
    if (pbProc) {
      try { pbProc.kill(); } catch {}
      try {
        execSync('powershell -Command "Get-NetTCPConnection -LocalPort 8091 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"', { stdio: 'ignore' });
      } catch {}
    }
  }
}

// Direct execution
if (process.argv[1]?.endsWith('migrate-sweep-schemas.ts')) {
  runMigration().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
