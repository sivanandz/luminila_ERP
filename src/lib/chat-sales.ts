/**
 * Chat sales service.
 *
 * "Create order" from a WhatsApp conversation. The operation goes through the
 * same capture contract as the storefront: a real `sales_orders` document with
 * variant-persisted items, server-recomputed prices and tax, channel stock, a
 * payment trail, customer aggregates/loyalty and a durable order reference.
 *
 * 2026-10-24 open-issue pass (CO-10/12/24):
 *  - prices are read from the database (`channel_prices.whatsapp` → base price),
 *    never from the caller; the client total is informational only;
 *  - the order is written before its children, and a failure compensates the
 *    stock and cancels the header instead of leaving an orphan sale;
 *  - an optional idempotency key makes a double-click/retry resolve to the same
 *    order instead of creating a second one.
 */

import { pb, getCurrentTenantEmail } from './pocketbase';
import { getChannelPriceFromList } from './pricing-rules';
import { loadTenantChannelDefinitions } from './server-pricing';
import {
    upsertChannelCustomer,
    applyPurchaseAggregates,
    computeChannelTax,
    findExistingChannelOrder,
    loadChannelStoreTaxContext,
    AGGREGATES_MARKER,
    type ChannelTaxLine,
} from './channel-orders';
import {
    applyChannelStock,
    assertStockAvailable,
    restoreChannelStockForReference,
    InsufficientStockError,
    VariantMismatchError,
    VariantRequiredError,
    toStockDb,
} from './channel-stock';
import { getStateCode } from './gst';
import { recordConsentEvent } from './consent-ledger';
import { linkChatOrder } from './whatsapp-order-links';
import { calculatePointsToEarn, earnPoints } from './loyalty';

export interface ChatCartLine {
    id: string;
    /** Explicit variant when the conversation resolved one. */
    variantId?: string;
    /** Client-side display price. Ignored for pricing — the database is authoritative. */
    base_price?: number;
    quantity?: number;
    name?: string;
}

export interface ChatSaleInput {
    customerName: string;
    customerPhone: string;
    customerId?: string;
    cart: ChatCartLine[];
    /** Client quote for display only; the service recomputes the real total. */
    total?: number;
    /** WhatsApp chat id the order came from, for order↔conversation linkage (F3). */
    chatId?: string;
    shippingAddress?: string;
    city?: string;
    state?: string;
    pincode?: string;
    /** WhatsApp message id when the order came from catalog ingestion (A32). */
    messageId?: string;
    /** B2B capture when the customer is a business buyer (A3/A4). */
    companyName?: string;
    gstin?: string;
    billingAddress?: string;
    /** Stable key so an operator retry/double-click returns the same order. */
    idempotencyKey?: string;
}

export interface ChatSaleResult {
    saleId: string;
    orderId: string;
    orderNumber: string;
    paymentRef: string;
    paymentUrl: string | null;
    customerId: string;
    total: number;
    taxTotal: number;
    duplicate?: boolean;
}

interface PricedLine {
    productId: string;
    variantId: string;
    name: string;
    price: number;
    quantity: number;
}

function cleanKey(raw?: string): string {
    return (raw || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
}

async function existingOrderResult(
    txnId: string,
    orderNumber: string
): Promise<ChatSaleResult | null> {
    const existing = await findExistingChannelOrder(pb, orderNumber);
    if (!existing) return null;
    const [sale, link] = await Promise.all([
        pb.collection('sales').getFirstListItem(`channel_order_id = "${txnId}"`).catch(() => null),
        pb.collection('payment_links').getFirstListItem(`order = "${existing.id}"`).catch(() => null),
    ]);
    return {
        saleId: sale?.id || '',
        orderId: existing.id,
        orderNumber: existing.order_number || orderNumber,
        paymentRef: (link as { link_id?: string } | null)?.link_id || txnId,
        paymentUrl: (link as { short_url?: string } | null)?.short_url || null,
        customerId: existing.customer || '',
        total: Number(existing.total) || 0,
        taxTotal: Number((existing as { tax_total?: number }).tax_total) || 0,
        duplicate: true,
    };
}

export async function createSaleFromChat(input: ChatSaleInput): Promise<ChatSaleResult> {
    if (!Array.isArray(input.cart) || input.cart.length === 0) {
        throw new Error('Cannot create a sale from an empty cart');
    }

    const tenantEmail = getCurrentTenantEmail();
    if (!tenantEmail) {
        throw new Error('No tenant is selected, so the order cannot be recorded.');
    }

    const key = cleanKey(input.idempotencyKey);
    const txnId = key ? `WA-${key}` : `WA-${Date.now().toString(36).toUpperCase()}`;
    const orderNumber = `ORD-${txnId}`;

    if (key) {
        const duplicate = await existingOrderResult(txnId, orderNumber);
        if (duplicate) return duplicate;
    }

    // 1. Price and resolve every line from the database (CO-10). The caller's
    // `base_price` is never trusted; variant ambiguity still fails loudly.
    const channelDefinitions = await loadTenantChannelDefinitions(pb, tenantEmail);
    const lines: PricedLine[] = [];
    for (const item of input.cart) {
        const product = await pb
            .collection('products')
            .getOne<{ id: string; name?: string; base_price?: number; cost_price?: number; is_active?: boolean; channel_prices?: Record<string, number> }>(
                item.id
            )
            .catch(() => null);
        if (!product) throw new Error(`Product not found: ${item.name || item.id}`);
        if (product.is_active === false) {
            throw new Error(`Product is unavailable: ${product.name || item.id}`);
        }

        const channelPrices = product.channel_prices || {};
        const price = getChannelPriceFromList(
            {
                base_price: Number(product.base_price) || 0,
                cost_price: Number(product.cost_price) || 0,
                channel_prices: channelPrices,
            },
            'whatsapp',
            channelDefinitions
        );
        if (price <= 0) {
            throw new Error(`Product has no valid pricing configured: ${product.name || item.id}`);
        }

        let variantId = item.variantId || '';
        if (variantId) {
            const variant = await pb.collection('product_variants').getOne(variantId).catch(() => null);
            if (!variant || variant.product !== item.id) {
                throw new VariantMismatchError(item.id, variantId);
            }
        } else {
            const variants = await pb.collection('product_variants').getFullList<{ id: string }>({
                filter: pb.filter('product = {:product}', { product: item.id }),
                fields: 'id',
            });
            if (variants.length > 1) {
                throw new VariantRequiredError(item.id, product.name || item.name || item.id, variants.length);
            }
            if (variants.length === 0) {
                throw new Error(
                    `Product has no variant rows; add one before selling it through chat: ${product.name || item.id}`
                );
            }
            variantId = variants[0].id;
        }

        lines.push({
            productId: item.id,
            variantId,
            name: product.name || item.name || 'Jewelry Item',
            price,
            quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
        });
    }

    // 2. Resolve the delivery address: explicit input first, then the customer
    // profile. A chat order without an address is unfulfillable (CO-10).
    let address = (input.shippingAddress || '').trim();
    let city = (input.city || '').trim();
    let state = (input.state || '').trim();
    let pincode = (input.pincode || '').trim();
    let companyName = (input.companyName || '').trim();
    let gstin = (input.gstin || '').trim().toUpperCase();
    let billingAddress = (input.billingAddress || '').trim();
    if ((!address || !state || !companyName || !gstin) && input.customerId) {
        const profile = await pb.collection('customers').getOne(input.customerId).catch(() => null);
        if (profile) {
            address = address || String(profile.address || '');
            city = city || String(profile.city || '');
            state = state || String(profile.state || '');
            pincode = pincode || String(profile.pincode || '');
            companyName = companyName || String(profile.company_name || '');
            gstin = gstin || String(profile.gstin || '').toUpperCase();
            billingAddress = billingAddress || String(profile.billing_address || '');
        }
    }
    if (!address) {
        throw new Error('A shipping address is required before the order can be created.');
    }

    const buyerStateCode = getStateCode(state);

    // 3. Customer: shared upsert so the chat channel keeps the same canonical
    // phone and profile-merge behaviour as the storefront.
    let customerId = input.customerId || '';
    if (!customerId) {
        const upserted = await upsertChannelCustomer(pb, {
            tenantEmail,
            name: input.customerName,
            phone: input.customerPhone,
            address,
            city,
            state,
            stateCode: buyerStateCode,
            pincode,
            source: 'whatsapp',
        });
        customerId = upserted.id;
    }

    // 4. Server-side money: subtotal from DB prices, tax-inclusive GST split.
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const storeTax = await loadChannelStoreTaxContext(pb, tenantEmail);
    if (storeTax.gstRegistered && !buyerStateCode) {
        throw new Error(
            'The delivery state is missing, so GST cannot be computed. Capture the customer state before creating the order.'
        );
    }
    const taxLines: ChannelTaxLine[] = lines.map((line) => ({
        gross: line.price * line.quantity,
    }));
    const tax = computeChannelTax(taxLines, 0, 0, {
        sellerStateCode: storeTax.sellerStateCode,
        buyerStateCode: buyerStateCode || storeTax.sellerStateCode,
        gstRegistered: storeTax.gstRegistered,
    });
    const total = subtotal;

    // 5. Stock availability before any write.
    const stockDb = toStockDb(pb);
    const stockLines = lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        name: line.name,
    }));
    const availability = await assertStockAvailable(stockDb, stockLines, { accountEmail: tenantEmail });
    if (!availability.ok) {
        const shortage = availability.shortages[0];
        throw new InsufficientStockError(
            shortage.productId,
            shortage.requested,
            shortage.available,
            shortage.name
        );
    }

    const shippingAddressLine = [address, city, state, pincode].filter(Boolean).join(', ');
    let orderId = '';
    let stockApplied = false;

    try {
        // 6. Parent first: the order header owns everything that follows.
        let salesOrder;
        try {
            salesOrder = await pb.collection('sales_orders').create({
                order_number: orderNumber,
                order_type: 'sales_order',
                customer: customerId,
                customer_name: input.customerName,
                customer_phone: input.customerPhone,
                billing_address: billingAddress || shippingAddressLine,
                shipping_address: shippingAddressLine,
                order_date: new Date().toISOString(),
                status: 'confirmed',
                subtotal,
                discount_total: 0,
                shipping_charges: 0,
                tax_total: tax.taxTotal,
                total,
                payment_status: 'PENDING',
                payment_method: 'upi',
                buyer_state_code: buyerStateCode,
                place_of_supply: buyerStateCode,
                capture_source: 'whatsapp',
                gateway: '',
                campaign: '',
                buyer_gstin: gstin,
                buyer_company: companyName,
                whatsapp_chat: input.chatId || '',
                account_email: tenantEmail,
                internal_notes: `WhatsApp concierge order${
                    input.chatId ? ` from chat ${input.chatId}` : ''
                }. GST ${tax.blendedRate}% inclusive, taxable ₹${tax.taxableValue.toFixed(2)}.`,
                notes: `WhatsApp order ${orderNumber}`,
            });
        } catch (createErr) {
            const msg = String(
                (createErr as { response?: { data?: { order_number?: { message?: string } } } })?.response
                    ?.data?.order_number?.message ||
                    (createErr as Error)?.message ||
                    ''
            );
            if (!/unique/i.test(msg)) throw createErr;
            const duplicate = await existingOrderResult(txnId, orderNumber);
            if (!duplicate) throw createErr;
            return duplicate;
        }

        orderId = salesOrder.id;

        // 7. Line items — variant is a required relation, failures surface.
        for (const line of lines) {
            await pb.collection('sales_order_items').create({
                order: orderId,
                product: line.productId,
                variant: line.variantId,
                description: line.name,
                quantity: line.quantity,
                unit_price: line.price,
                total: line.price * line.quantity,
                account_email: tenantEmail,
            });
        }

        // 8. Stock + ledger through the shared service.
        await applyChannelStock(stockDb, stockLines, {
            accountEmail: tenantEmail,
            channel: 'whatsapp',
            referenceId: orderId,
            notes: `WhatsApp concierge order ${orderNumber}`,
        });
        stockApplied = true;

        // 9. Payment trail: a pending manual-UPI row exists from creation.
        await pb.collection('payment_links').create({
            provider: 'manual_upi',
            link_id: txnId,
            amount: total,
            currency: 'INR',
            order: orderId,
            status: 'pending',
            notes: {
                source: 'whatsapp_concierge',
                chat_id: input.chatId || '',
                txn: txnId,
            },
            account_email: tenantEmail,
        });

        // 10. POS revenue mirror (best effort — the order is the source of truth).
        let saleId = '';
        try {
            const sale = await pb.collection('sales').create({
                customer: customerId,
                customer_name: input.customerName,
                customer_phone: input.customerPhone,
                customer_address: shippingAddressLine,
                subtotal,
                discount: 0,
                total,
                status: 'pending',
                channel: 'whatsapp',
                channel_order_id: txnId,
                payment_method: 'upi',
                notes: `WhatsApp concierge order ${orderNumber}${
                    input.chatId ? ` [chat ${input.chatId}]` : ''
                }`,
            });
            saleId = sale.id;
            for (const line of lines) {
                await pb
                    .collection('sale_items')
                    .create({
                        sale: sale.id,
                        product: line.productId,
                        variant: line.variantId,
                        quantity: line.quantity,
                        unit_price: line.price,
                        total_price: line.price * line.quantity,
                        total: line.price * line.quantity,
                        discount: 0,
                    })
                    .catch(() => {});
            }
        } catch (mirrorErr) {
            console.warn('[chat-sales] sales mirror write failed (order is durable):', mirrorErr);
        }

        // 11. Aggregates + loyalty parity, then the counted marker.
        await applyPurchaseAggregates(pb, customerId, total);
        try {
            const points = await calculatePointsToEarn(total);
            if (points > 0) {
                await earnPoints(customerId, total, 'sales_order', orderId);
            }
        } catch (loyaltyErr) {
            console.warn('[chat-sales] loyalty award skipped:', loyaltyErr);
        }
        try {
            const fresh = await pb.collection('sales_orders').getOne(orderId);
            await pb.collection('sales_orders').update(orderId, {
                internal_notes: [fresh.internal_notes, AGGREGATES_MARKER].filter(Boolean).join('\n'),
            });
        } catch (markErr) {
            console.warn('[chat-sales] aggregate marker write failed:', markErr);
        }

        // Conversation backlink + consent trail (A30/A32), best-effort.
        await linkChatOrder(pb, {
            tenantEmail,
            chatId: input.chatId,
            messageId: input.messageId,
            orderId,
        });
        await recordConsentEvent(pb, {
            customerId,
            phone: input.customerPhone,
            channel: 'whatsapp',
            purpose: 'transactional',
            granted: true,
            source: 'whatsapp_order',
            orderId,
        });
        await recordConsentEvent(pb, {
            customerId,
            phone: input.customerPhone,
            channel: 'whatsapp',
            purpose: 'whatsapp_service',
            granted: true,
            source: 'whatsapp_order',
            orderId,
        });

        return {
            saleId,
            orderId,
            orderNumber,
            paymentRef: txnId,
            paymentUrl: null,
            customerId,
            total,
            taxTotal: tax.taxTotal,
        };
    } catch (err) {
        // 12. Compensation: never leave an order that cannot be fulfilled or a
        // stock deduction with no order.
        if (orderId) {
            if (stockApplied) {
                await restoreChannelStockForReference(stockDb, {
                    referenceId: orderId,
                    channel: 'whatsapp',
                    notes: 'Compensated failed chat order creation',
                }).catch(() => {});
            }
            await pb.collection('sales_orders').update(orderId, { status: 'cancelled' }).catch(() => {});
        }
        throw err;
    }
}

/** Look up a chat-created order by its WhatsApp txn reference. */
export async function findChatSaleByRef(txnId: string): Promise<{ orderId: string } | null> {
    const order = await pb.collection('sales_orders').getFirstListItem(
        `order_number = "${txnId.replace(/"/g, '')}"`
    ).catch(() => null);
    return order ? { orderId: order.id } : null;
}
