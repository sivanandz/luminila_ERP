/**
 * Script to apply RLS bypass policies for development
 * Run with: npx tsx scripts/apply-rls-bypass.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env.local');
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('   NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? '✓' : '✗');
    process.exit(1);
}

console.log('🔗 Connecting to Supabase:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

const rlsPolicies = `
-- RLS Bypass Policies for Development
-- Core tables
CREATE POLICY IF NOT EXISTS "anon_products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_product_variants" ON product_variants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_vendors" ON vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_vendor_products" ON vendor_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_sales" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_sale_items" ON sale_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_stock_movements" ON stock_movements FOR ALL USING (true) WITH CHECK (true);

-- Customer tables
CREATE POLICY IF NOT EXISTS "anon_customers" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_customer_interactions" ON customer_interactions FOR ALL USING (true) WITH CHECK (true);

-- Invoice tables
CREATE POLICY IF NOT EXISTS "anon_invoices" ON invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_invoice_items" ON invoice_items FOR ALL USING (true) WITH CHECK (true);

-- Returns tables
CREATE POLICY IF NOT EXISTS "anon_credit_notes" ON credit_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_credit_note_items" ON credit_note_items FOR ALL USING (true) WITH CHECK (true);

-- Purchase tables
CREATE POLICY IF NOT EXISTS "anon_purchase_orders" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_purchase_order_items" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_goods_received_notes" ON goods_received_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_grn_items" ON grn_items FOR ALL USING (true) WITH CHECK (true);

-- Sales Orders tables
CREATE POLICY IF NOT EXISTS "anon_sales_orders" ON sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_sales_order_items" ON sales_order_items FOR ALL USING (true) WITH CHECK (true);

-- Activity logs
CREATE POLICY IF NOT EXISTS "anon_activity_logs" ON activity_logs FOR ALL USING (true) WITH CHECK (true);
`;

async function applyPolicies() {
    console.log('📦 Applying RLS bypass policies...\n');

    // Split into individual statements
    const statements = rlsPolicies
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    let success = 0;
    let failed = 0;

    for (const statement of statements) {
        const policyMatch = statement.match(/CREATE POLICY.*?"([^"]+)"/);
        const policyName = policyMatch ? policyMatch[1] : 'unknown';

        try {
            const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });

            if (error) {
                // Try alternative: direct query (won't work with anon key, but worth trying)
                console.log(`   ⚠️  ${policyName}: ${error.message}`);
                failed++;
            } else {
                console.log(`   ✓ ${policyName}`);
                success++;
            }
        } catch (err: any) {
            console.log(`   ⚠️  ${policyName}: ${err.message || 'Failed'}`);
            failed++;
        }
    }

    console.log(`\n📊 Results: ${success} succeeded, ${failed} failed`);

    if (failed > 0) {
        console.log('\n⚠️  Some policies failed. This is expected because the anon key cannot execute DDL.');
        console.log('   You need to run the SQL manually in the Supabase Dashboard → SQL Editor.');
        console.log('   The SQL file is: supabase/migrations/015_dev_rls_bypass.sql');
    }
}

applyPolicies().catch(console.error);
