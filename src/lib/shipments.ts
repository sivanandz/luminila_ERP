/**
 * Shipment records for AWB dispatch (D-23).
 *
 * `shipments` is one of the collections created by migration 008; the dispatch
 * modal used to write it and update the order inline.
 */

import { pb } from './pocketbase';

export interface ShipmentInput {
    orderId: string;
    carrier: string;
    awbNumber: string;
    shippingStatus?: string;
    trackingUrl?: string;
    codAmount?: number;
    weightGrams?: number;
}

export async function createShipment(input: ShipmentInput): Promise<{ id: string }> {
    const record = await pb.collection('shipments').create({
        order_id: input.orderId,
        carrier: input.carrier,
        awb_number: input.awbNumber,
        shipping_status: input.shippingStatus || 'manifested',
        tracking_url: input.trackingUrl || '',
        cod_amount: input.codAmount ?? 0,
        weight_grams: input.weightGrams ?? 0,
    });
    return { id: record.id };
}
