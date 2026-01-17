/**
 * Cash Register & Shift Management
 * Handles cash drawer operations, shift tracking, and tender calculations using PocketBase
 */

import { pb } from './pocketbase';

// =============================================
// Types
// =============================================

export type ShiftStatus = 'open' | 'closed' | 'suspended';

export interface CashRegisterShift {
    id: string;
    user: string; // Relation ID
    terminal_id?: string;
    opened_at: string;
    closed_at?: string;
    opening_balance: number;
    closing_balance?: number;
    expected_balance?: number;
    total_cash_sales: number;
    total_card_sales: number;
    total_upi_sales: number;
    total_cash_refunds: number;
    cash_added: number;
    cash_removed: number;
    variance?: number;
    variance_notes?: string;
    status: ShiftStatus;
    notes?: string;
    created: string;
    updated: string;
    // Expanded fields
    expand?: {
        user?: {
            name: string;
            email: string;
        };
    };
}

export interface DrawerOperation {
    id: string;
    shift: string; // Relation
    operation_type: 'add' | 'remove' | 'sale' | 'refund';
    amount: number;
    reason?: string;
    performed_by?: string;
    performed_at: string;
    created: string;
    updated: string;
}

export interface ShiftSummary {
    totalTransactions: number;
    cashSales: number;
    cardSales: number;
    upiSales: number;
    refunds: number;
    netCash: number;
    expectedBalance: number;
}

// =============================================
// Shift Management
// =============================================

/**
 * Open a new cash register shift
 */
export async function openShift(
    userId: string,
    openingBalance: number,
    terminalId?: string,
    notes?: string
): Promise<CashRegisterShift | null> {
    // Check for existing open shift
    const existingShift = await getCurrentShift(userId);
    if (existingShift) {
        throw new Error('You already have an open shift. Please close it before opening a new one.');
    }

    try {
        const record = await pb.collection('cash_register_shifts').create({
            user: userId,
            terminal_id: terminalId,
            opening_balance: openingBalance,
            opened_at: new Date().toISOString(),
            status: 'open',
            notes,
            // Init totals
            total_cash_sales: 0,
            total_card_sales: 0,
            total_upi_sales: 0,
            total_cash_refunds: 0,
            cash_added: 0,
            cash_removed: 0
        });

        // Add initial cash drop operation
        await addCashToDrawer(record.id, openingBalance, "Opening Balance", userId);

        return record as unknown as CashRegisterShift;
    } catch (error: any) {
        console.error('Error opening shift:', error);
        // Log detailed PocketBase error info
        if (error?.response?.data) {
            console.error('PocketBase validation errors:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Get the current open shift for a user
 */
export async function getCurrentShift(userId: string): Promise<CashRegisterShift | null> {
    try {
        const record = await pb.collection('cash_register_shifts').getFirstListItem<CashRegisterShift>(
            `user="${userId}" && status="open"`,
            {
                sort: '-created', // PocketBase uses 'created' instead of 'opened_at' usually, but we have opened_at.
                expand: 'user'
            }
        );
        return record;
    } catch (error) {
        // 404 is normal if no shift open
        return null;
    }
}

/**
 * Get shift by ID
 */
export async function getShift(shiftId: string): Promise<CashRegisterShift | null> {
    try {
        const record = await pb.collection('cash_register_shifts').getOne<CashRegisterShift>(shiftId, {
            expand: 'user'
        });
        return record;
    } catch (error) {
        console.error('Error getting shift:', error);
        return null;
    }
}

/**
 * Close a shift with reconciliation
 */
export async function closeShift(
    shiftId: string,
    closingBalance: number,
    varianceNotes?: string
): Promise<CashRegisterShift | null> {
    // Get current shift data
    const shift = await getShift(shiftId);
    if (!shift) {
        throw new Error('Shift not found');
    }

    if (shift.status !== 'open') {
        throw new Error('Shift is not open');
    }

    // Calculate expected balance
    const expectedBalance =
        shift.opening_balance +
        shift.total_cash_sales -
        shift.total_cash_refunds +
        shift.cash_added -
        shift.cash_removed;

    // Calculate variance
    const variance = closingBalance - expectedBalance;

    try {
        const record = await pb.collection('cash_register_shifts').update<CashRegisterShift>(shiftId, {
            closed_at: new Date().toISOString(),
            closing_balance: closingBalance,
            expected_balance: expectedBalance,
            variance,
            variance_notes: varianceNotes,
            status: 'closed'
        });
        return record;
    } catch (error) {
        console.error('Error closing shift:', error);
        throw error;
    }
}

/**
 * Suspend a shift (pause without closing)
 */
export async function suspendShift(shiftId: string): Promise<boolean> {
    try {
        await pb.collection('cash_register_shifts').update(shiftId, {
            status: 'suspended'
        });
        return true;
    } catch (error) {
        console.error('Error suspending shift:', error);
        return false;
    }
}

/**
 * Resume a suspended shift
 */
export async function resumeShift(shiftId: string): Promise<boolean> {
    try {
        // Need to verify it was suspended first? not strictly necessary if ID matches
        await pb.collection('cash_register_shifts').update(shiftId, {
            status: 'open'
        });
        return true;
    } catch (error) {
        console.error('Error resuming shift:', error);
        return false;
    }
}

// =============================================
// Cash Drawer Operations
// =============================================

/**
 * Add cash to drawer (e.g., float, cash drop)
 */
export async function addCashToDrawer(
    shiftId: string,
    amount: number,
    reason: string,
    performedBy: string
): Promise<boolean> {
    try {
        // Record operation
        await pb.collection('cash_drawer_operations').create({
            shift: shiftId,
            operation_type: 'add',
            amount,
            reason,
            performed_by: performedBy,
            performed_at: new Date().toISOString()
        });

        // Update shift total
        const shift = await getShift(shiftId);
        if (shift) {
            await pb.collection('cash_register_shifts').update(shiftId, {
                cash_added: (shift.cash_added || 0) + amount
            });
        }

        return true;
    } catch (error) {
        console.error('Error adding cash to drawer:', error);
        return false;
    }
}

/**
 * Remove cash from drawer (e.g., cash pickup, payout)
 */
export async function removeCashFromDrawer(
    shiftId: string,
    amount: number,
    reason: string,
    performedBy: string
): Promise<boolean> {
    try {
        // Record operation
        await pb.collection('cash_drawer_operations').create({
            shift: shiftId,
            operation_type: 'remove',
            amount,
            reason,
            performed_by: performedBy,
            performed_at: new Date().toISOString()
        });

        // Update shift total
        const shift = await getShift(shiftId);
        if (shift) {
            await pb.collection('cash_register_shifts').update(shiftId, {
                cash_removed: (shift.cash_removed || 0) + amount
            });
        }
        return true;
    } catch (error) {
        console.error('Error removing cash from drawer:', error);
        return false;
    }
}

/**
 * Get all operations for a shift
 */
export async function getShiftOperations(shiftId: string): Promise<DrawerOperation[]> {
    try {
        const records = await pb.collection('cash_drawer_operations').getFullList<DrawerOperation>({
            filter: `shift="${shiftId}"`,
            sort: 'performed_at'
        });
        return records;
    } catch (error) {
        console.error('Error getting shift operations:', error);
        return [];
    }
}

// =============================================
// Tender Tracking
// =============================================

/**
 * Calculate change for a cash transaction
 */
export function calculateChange(totalAmount: number, cashTendered: number): number {
    return Math.max(0, cashTendered - totalAmount);
}

/**
 * Record tender information for a sale
 */
export async function recordTender(
    saleId: string,
    shiftId: string,
    cashTendered: number,
    changeGiven: number
): Promise<boolean> {
    try {
        await pb.collection('sales').update(saleId, {
            cash_tendered: cashTendered,
            change_given: changeGiven,
            register_shift_id: shiftId
        });

        // Also update shift sales total if it's a cash sale?
        // Logic might be duplicated here vs where sale is created.
        // Assuming Sale Creation updates the shift totals, or we rely on aggregation.
        // For simplicity, let's assume we update shift totals here if we want real-time shift stats.
        // But cleaner to do it at sale creation.

        return true;
    } catch (error) {
        console.error('Error recording tender:', error);
        return false;
    }
}

// =============================================
// Shift History & Reporting
// =============================================

/**
 * Get shift history for a user or all users
 */
export async function getShiftHistory(
    options: {
        userId?: string;
        startDate?: string;
        endDate?: string;
        status?: ShiftStatus;
        limit?: number;
    } = {}
): Promise<CashRegisterShift[]> {
    try {
        let filter = '';
        const conditions: string[] = [];

        if (options.userId) conditions.push(`user="${options.userId}"`);
        if (options.status) conditions.push(`status="${options.status}"`);
        if (options.startDate) conditions.push(`opened_at>="${options.startDate}"`);
        if (options.endDate) conditions.push(`opened_at<="${options.endDate}"`);

        filter = conditions.join(' && ');

        const records = await pb.collection('cash_register_shifts').getList<CashRegisterShift>(1, options.limit || 50, {
            filter,
            sort: '-opened_at',
            expand: 'user'
        });

        return records.items;
    } catch (error) {
        console.error('Error getting shift history:', error);
        return [];
    }
}

/**
 * Get shift summary statistics
 */
export async function getShiftSummary(shiftId: string): Promise<ShiftSummary | null> {
    const shift = await getShift(shiftId);
    if (!shift) return null;

    // Get transaction count for this shift
    // PocketBase doesn't have a direct count API without fetching list or setting expected total
    // But we can fetch with limit 1 and get totalItems
    try {
        const salesResult = await pb.collection('sales').getList(1, 1, {
            filter: `register_shift_id="${shiftId}"`
        });

        const count = salesResult.totalItems;

        const expectedBalance =
            shift.opening_balance +
            shift.total_cash_sales -
            shift.total_cash_refunds +
            shift.cash_added -
            shift.cash_removed;

        return {
            totalTransactions: count,
            cashSales: shift.total_cash_sales,
            cardSales: shift.total_card_sales,
            upiSales: shift.total_upi_sales,
            refunds: shift.total_cash_refunds,
            netCash: shift.total_cash_sales - shift.total_cash_refunds,
            expectedBalance
        };

    } catch (err) {
        return null;
    }
}

/**
 * Get today's shift for a user (most recent)
 */
export async function getTodayShift(userId: string): Promise<CashRegisterShift | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    try {
        const record = await pb.collection('cash_register_shifts').getFirstListItem<CashRegisterShift>(
            `user="${userId}" && opened_at>="${todayStr}"`,
            {
                sort: '-opened_at',
                expand: 'user'
            }
        );
        return record;
    } catch (error) {
        return null; // Not found
    }
}
