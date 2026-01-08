/**
 * Loyalty Points System
 * Customer loyalty program with points earning, redemption, and tier management using PocketBase
 */

import { pb } from './pocketbase';

// =============================================
// Types
// =============================================

export interface LoyaltyTier {
    id: string;
    name: string;
    min_points: number;
    max_points?: number;
    multiplier: number;
    discount_percent: number;
    color: string;
    icon?: string;
    benefits: string[];
    created: string;
}

export interface LoyaltyAccount {
    id: string;
    customer: string; // Relation
    tier?: string; // Relation
    total_points_earned: number;
    total_points_redeemed: number;
    current_balance: number;
    lifetime_value: number;
    member_since: string;
    last_activity: string;
    is_active: boolean;
    notes?: string;
    created: string;
    updated: string;
    expand?: {
        tier?: LoyaltyTier;
        customer?: {
            name: string;
            email: string;
            phone?: string;
        };
    };
}

export type TransactionType = 'earn' | 'redeem' | 'adjust' | 'expire' | 'bonus';

export interface LoyaltyTransaction {
    id: string;
    account: string; // Relation
    type: TransactionType;
    points: number;
    balance_after: number;
    reference_type?: string;
    reference_id?: string;
    description?: string;
    created: string;
}

export interface LoyaltySettings {
    id: string;
    points_per_rupee: number;
    redemption_value: number;
    min_redemption_points: number;
    max_redemption_percent: number;
    points_validity_days: number;
    signup_bonus: number;
    birthday_bonus: number;
    referral_bonus: number;
    is_active: boolean;
}

// =============================================
// Settings
// =============================================

let cachedSettings: LoyaltySettings | null = null;

export async function getLoyaltySettings(): Promise<LoyaltySettings | null> {
    if (cachedSettings) return cachedSettings;

    try {
        const record = await pb.collection('loyalty_settings').getFirstListItem<LoyaltySettings>('is_active=true');
        cachedSettings = record;
        return record;
    } catch (error) {
        console.error('Error fetching loyalty settings:', error);
        return null;
    }
}

// =============================================
// Tiers
// =============================================

export async function getLoyaltyTiers(): Promise<LoyaltyTier[]> {
    try {
        const records = await pb.collection('loyalty_tiers').getFullList<LoyaltyTier>({
            sort: 'min_points',
        });
        return records;
    } catch (error) {
        console.error('Error fetching loyalty tiers:', error);
        return [];
    }
}

export async function getTierByPoints(points: number): Promise<LoyaltyTier | null> {
    try {
        const record = await pb.collection('loyalty_tiers').getFirstListItem<LoyaltyTier>(
            `min_points <= ${points} && (max_points = 0 || max_points >= ${points})`,
            { sort: '-min_points' }
        );
        return record;
    } catch (error) {
        // Fallback? or return null
        return null;
    }
}

// =============================================
// Accounts
// =============================================

export async function getLoyaltyAccount(customerId: string): Promise<LoyaltyAccount | null> {
    try {
        const record = await pb.collection('loyalty_accounts').getFirstListItem<LoyaltyAccount>(
            `customer="${customerId}"`,
            {
                expand: 'tier,customer'
            }
        );
        return record;
    } catch (error) {
        return null;
    }
}

export async function createLoyaltyAccount(customerId: string): Promise<LoyaltyAccount | null> {
    const settings = await getLoyaltySettings();
    const tiers = await getLoyaltyTiers();
    const bronzeTier = tiers.find(t => t.name === 'Bronze') || tiers[0];
    const signupBonus = settings?.signup_bonus || 0;

    try {
        const record = await pb.collection('loyalty_accounts').create({
            customer: customerId,
            tier: bronzeTier?.id,
            total_points_earned: signupBonus,
            current_balance: signupBonus,
            member_since: new Date().toISOString(),
            is_active: true
        });

        // Record signup bonus transaction
        if (signupBonus > 0) {
            await recordTransaction(record.id, 'bonus', signupBonus, signupBonus, 'Welcome bonus');
        }

        return record as unknown as LoyaltyAccount;
    } catch (error) {
        console.error('Error creating loyalty account:', error);
        return null;
    }
}

export async function getOrCreateLoyaltyAccount(customerId: string): Promise<LoyaltyAccount | null> {
    let account = await getLoyaltyAccount(customerId);
    if (!account) {
        account = await createLoyaltyAccount(customerId);
    }
    return account;
}

// =============================================
// Points Calculation
// =============================================

export async function calculatePointsToEarn(purchaseAmount: number, tierId?: string): Promise<number> {
    const settings = await getLoyaltySettings();
    if (!settings) return 0;

    // Base points: amount / 100 * points_per_rupee
    let points = Math.floor((purchaseAmount / 100) * settings.points_per_rupee);

    // Apply tier multiplier
    if (tierId) {
        try {
            const tier = await pb.collection('loyalty_tiers').getOne<LoyaltyTier>(tierId);
            if (tier?.multiplier) {
                points = Math.floor(points * tier.multiplier);
            }
        } catch { }
    }

    return points;
}

export async function calculateRedemptionValue(points: number): Promise<number> {
    const settings = await getLoyaltySettings();
    if (!settings) return 0;

    return points * settings.redemption_value;
}

export async function calculateMaxRedeemablePoints(billAmount: number, currentBalance: number): Promise<number> {
    const settings = await getLoyaltySettings();
    if (!settings) return 0;

    // Check minimum redemption
    if (currentBalance < settings.min_redemption_points) {
        return 0;
    }

    // Calculate max based on bill percentage
    const maxValueFromBill = billAmount * (settings.max_redemption_percent / 100);
    const maxPointsFromBill = Math.floor(maxValueFromBill / settings.redemption_value);

    // Return minimum of available balance and max allowed
    return Math.min(currentBalance, maxPointsFromBill);
}

// =============================================
// Transactions
// =============================================

async function recordTransaction(
    accountId: string,
    type: TransactionType,
    points: number,
    balanceAfter: number,
    description?: string,
    referenceType?: string,
    referenceId?: string
): Promise<LoyaltyTransaction | null> {
    try {
        const record = await pb.collection('loyalty_transactions').create({
            account: accountId,
            type,
            points,
            balance_after: balanceAfter,
            description,
            reference_type: referenceType,
            reference_id: referenceId,
        });
        return record as unknown as LoyaltyTransaction;
    } catch (error) {
        console.error('Error recording loyalty transaction:', error);
        return null;
    }
}

export async function earnPoints(
    customerId: string,
    purchaseAmount: number,
    referenceType: string,
    referenceId: string
): Promise<{ pointsEarned: number; newBalance: number } | null> {
    const account = await getOrCreateLoyaltyAccount(customerId);
    if (!account) return null;

    const pointsToEarn = await calculatePointsToEarn(purchaseAmount, account.tier); // account.tier is ID actually in relation unless expanded, but for calculation we need ID or object. PB generic types are tricky.

    if (pointsToEarn <= 0) return { pointsEarned: 0, newBalance: account.current_balance };

    const newBalance = account.current_balance + pointsToEarn;
    const newTotalEarned = account.total_points_earned + pointsToEarn;

    try {
        // Update account
        await pb.collection('loyalty_accounts').update(account.id, {
            current_balance: newBalance,
            total_points_earned: newTotalEarned,
            lifetime_value: account.lifetime_value + purchaseAmount,
            last_activity: new Date().toISOString(),
        });

        // Record transaction
        await recordTransaction(
            account.id,
            'earn',
            pointsToEarn,
            newBalance,
            `Earned from ${referenceType}`,
            referenceType,
            referenceId
        );

        return { pointsEarned: pointsToEarn, newBalance };
    } catch (error) {
        console.error('Error updating loyalty account:', error);
        return null;
    }
}

export async function redeemPoints(
    customerId: string,
    pointsToRedeem: number,
    referenceType: string,
    referenceId: string
): Promise<{ redeemed: boolean; valueApplied: number; newBalance: number } | null> {
    const account = await getLoyaltyAccount(customerId);
    if (!account) return null;

    // Validate
    if (pointsToRedeem > account.current_balance) {
        throw new Error('Insufficient points balance');
    }

    const settings = await getLoyaltySettings();
    if (!settings) return null;

    if (pointsToRedeem < settings.min_redemption_points) {
        throw new Error(`Minimum ${settings.min_redemption_points} points required for redemption`);
    }

    const valueApplied = await calculateRedemptionValue(pointsToRedeem);
    const newBalance = account.current_balance - pointsToRedeem;
    const newTotalRedeemed = account.total_points_redeemed + pointsToRedeem;

    try {
        // Update account
        await pb.collection('loyalty_accounts').update(account.id, {
            current_balance: newBalance,
            total_points_redeemed: newTotalRedeemed,
            last_activity: new Date().toISOString(),
        });

        // Record transaction (negative points for redemption)
        await recordTransaction(
            account.id,
            'redeem',
            -pointsToRedeem,
            newBalance,
            `Redeemed for ${referenceType}`,
            referenceType,
            referenceId
        );

        return { redeemed: true, valueApplied, newBalance };
    } catch (error) {
        console.error('Error redeeming loyalty points:', error);
        return null;
    }
}

export async function adjustPoints(
    customerId: string,
    pointsAdjustment: number,
    reason: string,
    performedBy?: string
): Promise<{ newBalance: number } | null> {
    const account = await getLoyaltyAccount(customerId);
    if (!account) return null;

    const newBalance = account.current_balance + pointsAdjustment;
    if (newBalance < 0) {
        throw new Error('Adjustment would result in negative balance');
    }

    try {
        // Update account
        await pb.collection('loyalty_accounts').update(account.id, {
            current_balance: newBalance,
            total_points_earned: pointsAdjustment > 0
                ? account.total_points_earned + pointsAdjustment
                : account.total_points_earned,
            last_activity: new Date().toISOString(),
        });

        // Record transaction
        await recordTransaction(
            account.id,
            'adjust',
            pointsAdjustment,
            newBalance,
            reason,
            'manual'
        );

        return { newBalance };
    } catch (error) {
        console.error('Error adjusting loyalty points:', error);
        return null;
    }
}

// =============================================
// Transaction History
// =============================================

export async function getTransactionHistory(
    customerId: string,
    options: { limit?: number; offset?: number } = {}
): Promise<LoyaltyTransaction[]> {
    const account = await getLoyaltyAccount(customerId);
    if (!account) return [];

    try {
        const records = await pb.collection('loyalty_transactions').getList<LoyaltyTransaction>(
            options.offset ? (options.offset / (options.limit || 10)) + 1 : 1, // page
            options.limit || 10,
            {
                filter: `account="${account.id}"`,
                sort: '-created'
            }
        );
        return records.items;
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        return [];
    }
}

// =============================================
// Leaderboard & Stats
// =============================================

export async function getLoyaltyStats(): Promise<{
    totalMembers: number;
    activeMembers: number;
    totalPointsIssued: number;
    totalPointsRedeemed: number;
}> {
    try {
        // We can't easily get aggregates without iterating or maintaining separate stats document.
        // For now, let's just get counts. Sums are expensive in PB client-side.
        // Optimization: create a 'loyalty_stats' singleton collection updated by triggers, OR
        // just fetch list with fields only (lightweight-ish).
        // For MVP, just counts.

        const totalMembersResult = await pb.collection('loyalty_accounts').getList(1, 1);
        const activeMembersResult = await pb.collection('loyalty_accounts').getList(1, 1, { filter: 'is_active=true' });

        // Sums are hard. Let's assume 0 for now or implement aggressive fetching if needed.
        // Or write a small backend hook in PB (later).
        // For now implementing "dumb" summing for small datasets, or 0.
        // Warning: This will be slow for large datasets.

        return {
            totalMembers: totalMembersResult.totalItems,
            activeMembers: activeMembersResult.totalItems,
            totalPointsIssued: 0, // Pending aggregation solution
            totalPointsRedeemed: 0,
        };
    } catch (err) {
        return {
            totalMembers: 0,
            activeMembers: 0,
            totalPointsIssued: 0,
            totalPointsRedeemed: 0,
        };
    }
}

export async function getTopMembers(limit: number = 10): Promise<LoyaltyAccount[]> {
    try {
        const records = await pb.collection('loyalty_accounts').getList<LoyaltyAccount>(1, limit, {
            filter: 'is_active=true',
            sort: '-total_points_earned',
            expand: 'tier,customer'
        });
        return records.items;
    } catch (error) {
        console.error('Error fetching top members:', error);
        return [];
    }
}
