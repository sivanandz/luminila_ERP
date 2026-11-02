/**
 * Write tools: the only parts of the harness that mutate ERP data.
 *
 * They are never in a read-only profile, never appear in the model's tool menu
 * without `allowWrites`, and never execute without an explicit operator
 * approval for the exact pending call id (enforced by the agent loop).
 */

import { z } from 'zod';
import type { AiTool, AiToolContext } from './registry';
import {
    accountFilter,
    asNumber,
    asText,
    containsClause,
    escapeFilterValue,
    findFirstRecord,
    listRecords,
} from './pb-util';

const createCustomerInput = z.object({
    name: z.string().trim().min(2).max(120).describe('Customer full name.'),
    phone: z.string().trim().min(6).max(20).describe('Customer phone number with country/area code when known.'),
    email: z.string().trim().email().max(160).optional().describe('Optional email address.'),
    city: z.string().trim().max(80).optional().describe('Optional city.'),
    customerType: z.enum(['retail', 'wholesale', 'vip']).optional().describe('Customer segment. Default retail.'),
});

const addNoteInput = z.object({
    orderNumber: z.string().trim().min(1).max(60).describe('Sales order number, e.g. SO-2026-0007.'),
    note: z.string().trim().min(1).max(500).describe('Internal note to append for staff (not shown to the customer).'),
});

function normalizePhone(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
}

/** Last 10 digits, so `+91 98765 43210` and `9876543210` dedupe together. */
function phoneDedupeKey(phone: string): string {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * AI mutations are ERP writes: they must leave the same audit trail as a manual
 * edit (AI-SYS-11). A failed audit insert never fails the tool call.
 */
async function logAiMutation(
    context: AiToolContext,
    action: 'create' | 'update',
    entityType: 'customer' | 'order',
    entityId: string,
    description: string,
    newValues: Record<string, unknown>
): Promise<void> {
    try {
        await context.client.collection('activity_logs').create({
            action,
            entity_type: entityType,
            entity_id: entityId,
            description,
            new_values: newValues,
            // `activity_logs` stores its payload in `metadata`; keep new_values
            // too for readers that follow the AuditLog shape.
            metadata: { new_values: newValues },
            user_id: context.userId || '',
            user_name: context.sessionEmail || '',
            account_email: context.accountEmail,
        });
    } catch (error) {
        console.warn('AI activity log could not be written:', error);
    }
}

export const writeTools: AiTool[] = [
    {
        name: 'create_customer',
        title: 'Create customer',
        description:
            'Create a customer record after operator approval. Returns the existing record without writing when the phone number already exists.',
        kind: 'write',
        risk: 'medium',
        capability: { resource: 'customers', action: 'create' },
        input: createCustomerInput,
        execute: async (context, rawArgs) => {
            const args = createCustomerInput.parse(rawArgs);
            const phone = normalizePhone(args.phone);
            const dedupeKey = phoneDedupeKey(args.phone);
            if (!phone || !dedupeKey) throw new Error('A phone number is required to create a customer.');

            // Match on the last 10 digits so a number saved with or without the
            // country code is recognised as the same customer (AI-SYS-11).
            const candidates = await listRecords(context.client, 'customers', {
                filter: `${accountFilter(context.accountEmail)} && ${containsClause('phone', dedupeKey)}`,
                perPage: 10,
                fields: 'id,name,phone',
            }).catch(() => []);
            const existing = candidates.find(
                (candidate) => phoneDedupeKey(asText((candidate as Record<string, unknown>).phone)) === dedupeKey
            );
            if (existing) {
                const record = existing as unknown as Record<string, unknown>;
                return {
                    summary: `Customer already exists: ${asText(record.name) || phone} (id ${asText(record.id)}). No new record was created.`,
                    data: { created: false, customerId: asText(record.id) },
                };
            }

            const created = await context.client.collection('customers').create({
                name: args.name,
                phone,
                email: args.email ?? '',
                city: args.city ?? '',
                customer_type: args.customerType ?? 'retail',
                loyalty_points: 0,
                total_spent: 0,
                total_orders: 0,
                preferred_contact: 'whatsapp',
                opt_in_marketing: false,
                source: 'ai_assistant',
                account_email: context.accountEmail,
            } as Record<string, unknown>);
            const record = created as unknown as Record<string, unknown>;
            await logAiMutation(
                context,
                'create',
                'customer',
                asText(record.id),
                `Customer created by AI assistant: ${args.name}`,
                { name: args.name, phone, source: 'ai_assistant' }
            );
            return {
                summary: `Created customer ${args.name} (id ${asText(record.id)}) with phone ${phone}.`,
                data: { created: true, customerId: asText(record.id), name: args.name, phone },
            };
        },
    },
    {
        name: 'add_order_note',
        title: 'Append internal order note',
        description:
            'Append a timestamped internal note to a sales order after operator approval. Customer-facing data is not changed.',
        kind: 'write',
        risk: 'low',
        capability: { resource: 'sales', action: 'update' },
        input: addNoteInput,
        execute: async (context, rawArgs) => {
            const args = addNoteInput.parse(rawArgs);
            const order = await findFirstRecord(
                context.client,
                'sales_orders',
                `order_number = "${escapeFilterValue(args.orderNumber)}"`,
                context.accountEmail
            );
            if (!order) throw new Error(`No sales order found with number ${args.orderNumber}.`);

            const record = order as Record<string, unknown>;
            const current = asText(record.internal_notes);
            const stamp = `[${context.now.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${context.sessionEmail || 'operator'} via AI assistant]`;
            // Never truncate from the front: existing notes are audit data. The
            // per-note length is already bounded by the zod schema; the total field
            // is only guarded against runaway growth.
            const next = `${current ? `${current}\n` : ''}${stamp} ${args.note}`;
            if (next.length > 100_000) {
                throw new Error('This order already carries an excessive amount of internal notes; edit the order notes manually.');
            }
            await context.client.collection('sales_orders').update(asText(record.id), { internal_notes: next });
            await logAiMutation(
                context,
                'update',
                'order',
                asText(record.id),
                `Internal note appended by AI assistant to ${args.orderNumber}`,
                { order_number: args.orderNumber, note: args.note }
            );
            return {
                summary: `Appended a note to order ${args.orderNumber}.`,
                data: { updated: true, orderId: asText(record.id), orderNumber: args.orderNumber, note: args.note },
            };
        },
    },
];

// Re-export the helpers used above so a future write tool can stay in this file
// without re-importing the whole pb-util surface.
export { accountFilter, asNumber, asText, listRecords };
