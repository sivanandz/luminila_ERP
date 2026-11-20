/**
 * Loyalty Points System
 * Customer loyalty program with points earning, redemption, and tier management using PocketBase
 */

import type PocketBase from 'pocketbase';
import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';
import { enqueueTask } from './concurrency';

/** Tenant owning rows for a caller-supplied client, falling back to the module client (POS-22). */
function dbTenant(db: PocketBase = pb): string {
    const store = db.authStore as unknown as {
        record?: { email?: string; account_email?: string } | null;
        model?: { email?: string; account_email?: string } | null;
    };
    const record = store.record || store.model;
    return String(record?.account_email || record?.email || accountScopeEmail() || '')
        .trim()
        .toLowerCase();
}

function tenantClause(db: PocketBase = pb): string {
    const tenant = dbTenant(db);
    return tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
}

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

const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
    id: 'default',
    points_per_rupee: 0.1,
    redemption_value: 0.5,
    min_redemption_points: 100,
    max_redemption_percent: 50,
    points_validity_days: 365,
    signup_bonus: 50,
    birthday_bonus: 100,
    referral_bonus: 100,
    is_active: true,
};

/**
 * Read loyalty settings through an explicit client.
 *
 * CO-08: the capture path runs against a per-tenant client. The previous
 * module-level cache also leaked one tenant's settings into another tenant's
 * request, so settings are read per call through the caller's client.
 */
export async function getLoyaltySettings(db: PocketBase = pb): Promise<LoyaltySettings> {
    try {
        return await db.collection('loyalty_settings').getFirstListItem<LoyaltySettings>(
            `is_active=true${tenantClause(db)}`
        );
    } catch (error) {
        // A missing settings row is a fresh install: the documented defaults
        // apply. Any other failure must reach the caller — silently accruing
        // at the default rates hides a DB outage (CUS-11).
        if ((error as { status?: number })?.status === 404) {
            return DEFAULT_LOYALTY_SETTINGS;
        }
        console.error('Error fetching loyalty settings:', error);
        throw error;
    }
}

/** Persist tenant-scoped loyalty earn/redemption rate configuration. */
export async function saveLoyaltySettings(
    settings: Partial<LoyaltySettings>,
    db: PocketBase = pb
): Promise<LoyaltySettings> {
    const tenant = dbTenant(db);
    const payload = {
        points_per_rupee: Number(settings.points_per_rupee ?? DEFAULT_LOYALTY_SETTINGS.points_per_rupee),
        // A zero/negative rate divides by zero in the redemption cap and lets
        // points be debited for ₹0 (M-13).
        redemption_value: Math.max(
            0.01,
            Number(settings.redemption_value ?? DEFAULT_LOYALTY_SETTINGS.redemption_value)
        ),
        min_redemption_points: Math.max(
            0,
            Math.floor(Number(settings.min_redemption_points ?? DEFAULT_LOYALTY_SETTINGS.min_redemption_points))
        ),
        max_redemption_percent: Math.min(
            100,
            Math.max(0, Number(settings.max_redemption_percent ?? DEFAULT_LOYALTY_SETTINGS.max_redemption_percent))
        ),
        points_validity_days: Math.max(
            1,
            Math.floor(Number(settings.points_validity_days ?? DEFAULT_LOYALTY_SETTINGS.points_validity_days))
        ),
        signup_bonus: Math.max(0, Math.floor(Number(settings.signup_bonus ?? DEFAULT_LOYALTY_SETTINGS.signup_bonus))),
        birthday_bonus: Math.max(0, Math.floor(Number(settings.birthday_bonus ?? DEFAULT_LOYALTY_SETTINGS.birthday_bonus))),
        referral_bonus: Math.max(0, Math.floor(Number(settings.referral_bonus ?? DEFAULT_LOYALTY_SETTINGS.referral_bonus))),
        is_active: settings.is_active ?? true,
        ...(tenant ? { account_email: tenant } : {}),
    };

    const existing = await db
        .collection('loyalty_settings')
        .getFirstListItem<LoyaltySettings>(`is_active=true${tenantClause(db)}`)
        .catch(() => null);

    if (existing && existing.id && existing.id !== 'default') {
        return db.collection('loyalty_settings').update<LoyaltySettings>(existing.id, payload);
    }
    return db.collection('loyalty_settings').create<LoyaltySettings>(payload);
}

/** Seed default Bronze/Silver/Gold/Platinum loyalty tiers if the tenant has none. */
export async function seedDefaultLoyaltyTiers(db: PocketBase = pb): Promise<LoyaltyTier[]> {
    const existing = await getLoyaltyTiers(db);
    if (existing.length > 0) return existing;

    const tenant = dbTenant(db);
    const defaults: Array<Omit<LoyaltyTier, 'id' | 'created'>> = [
        {
            name: 'Bronze',
            min_points: 0,
            max_points: 999,
            multiplier: 1,
            discount_percent: 0,
            color: '#cd7f32',
            benefits: ['Earn points on every purchase'],
        },
        {
            name: 'Silver',
            min_points: 1000,
            max_points: 4999,
            multiplier: 1.25,
            discount_percent: 3,
            color: '#94a3b8',
            benefits: ['1.25x points multiplier', '3% member privilege'],
        },
        {
            name: 'Gold',
            min_points: 5000,
            max_points: 14999,
            multiplier: 1.5,
            discount_percent: 5,
            color: '#eab308',
            benefits: ['1.5x points multiplier', '5% member privilege', 'Priority styling previews'],
        },
        {
            name: 'Platinum',
            min_points: 15000,
            multiplier: 2,
            discount_percent: 10,
            color: '#38bdf8',
            benefits: ['2x points multiplier', '10% VIP privilege', 'Free express shipping'],
        },
    ];

    const created: LoyaltyTier[] = [];
    for (const tier of defaults) {
        const rec = await db.collection('loyalty_tiers').create<LoyaltyTier>({
            ...tier,
            ...(tenant ? { account_email: tenant } : {}),
        });
        created.push(rec);
    }
    return created;
}

// =============================================
// Tiers
// =============================================

export async function getLoyaltyTiers(db: PocketBase = pb): Promise<LoyaltyTier[]> {
    try {
        const records = await db.collection('loyalty_tiers').getFullList<LoyaltyTier>({
            filter: `id != ""${tenantClause(db)}`,
            sort: 'min_points',
        });
        return records;
    } catch (error) {
        console.error('Error fetching loyalty tiers:', error);
        return [];
    }
}

export async function getTierByPoints(points: number, db: PocketBase = pb): Promise<LoyaltyTier | null> {
    try {
        const record = await db.collection('loyalty_tiers').getFirstListItem<LoyaltyTier>(
            `min_points <= ${points} && (max_points = 0 || max_points >= ${points})${tenantClause(db)}`,
            { sort: '-min_points' }
        );
        return record;
    } catch {
        // Fallback? or return null
        return null;
    }
}

// =============================================
// Accounts
// =============================================

export async function getLoyaltyAccount(customerId: string, db: PocketBase = pb): Promise<LoyaltyAccount | null> {
    try {
        const record = await db.collection('loyalty_accounts').getFirstListItem<LoyaltyAccount>(
            `customer="${sanitizeFilter(customerId)}"${tenantClause(db)}`,
            {
                expand: 'tier,customer'
            }
        );
        return record;
    } catch {
        return null;
    }
}

export async function createLoyaltyAccount(customerId: string, db: PocketBase = pb): Promise<LoyaltyAccount | null> {
    const settings = await getLoyaltySettings(db);
    const tiers = await getLoyaltyTiers(db);
    const bronzeTier = tiers.find(t => t.name === 'Bronze') || tiers[0];
    const signupBonus = settings?.signup_bonus || 0;

    try {
        const record = await db.collection('loyalty_accounts').create({
            account_email: dbTenant(db),
            customer: customerId,
            tier: bronzeTier?.id,
            total_points_earned: signupBonus,
            current_balance: signupBonus,
            member_since: new Date().toISOString(),
            is_active: true
        });

        // Record signup bonus transaction
        if (signupBonus > 0) {
            await recordTransaction(record.id, 'bonus', signupBonus, signupBonus, 'Welcome bonus', undefined, undefined, db);
        }

        return record as unknown as LoyaltyAccount;
    } catch (error) {
        console.error('Error creating loyalty account:', error);
        return null;
    }
}

/**
 * Read-or-create without taking the queue lock.
 *
 * Only for callers already running inside `enqueueTask('loyalty_<id>')`:
 * re-entering the same key would wait on its own chain and deadlock.
 */
async function ensureLoyaltyAccount(customerId: string, db: PocketBase): Promise<LoyaltyAccount | null> {
    let account = await getLoyaltyAccount(customerId, db);
    // Re-check inside the task: the read above and the create below are not
    // atomic with each other, so the serialized re-entry is what prevents a
    // duplicate account (and a duplicate signup bonus) (CUS-9).
    if (!account) {
        account = await createLoyaltyAccount(customerId, db);
    }
    return account;
}

export async function getOrCreateLoyaltyAccount(customerId: string, db: PocketBase = pb): Promise<LoyaltyAccount | null> {
    return enqueueTask(`loyalty_${customerId}`, () => ensureLoyaltyAccount(customerId, db));
}

// =============================================
// Points Calculation
// =============================================

export async function calculatePointsToEarn(purchaseAmount: number, tierId?: string, db: PocketBase = pb): Promise<number> {
    const settings = await getLoyaltySettings(db);
    if (!settings) return 0;

    // The setting is labelled "points per ₹1", so it applies to every rupee —
    // dividing by 100 accrued only 1/100 of the promised points (M-09).
    let points = Math.floor(purchaseAmount * settings.points_per_rupee);

    // Apply tier multiplier
    if (tierId) {
        try {
            const tier = await db.collection('loyalty_tiers').getOne<LoyaltyTier>(tierId);
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

    // A legacy row can still hold a zero/negative rate: refuse redemption
    // rather than dividing by zero and offering the whole balance for ₹0 (M-13).
    if (!(settings.redemption_value > 0)) return 0;

    // Calculate max based on bill percentage
    const maxValueFromBill = billAmount * (settings.max_redemption_percent / 100);
    const maxPointsFromBill = Math.floor(maxValueFromBill / settings.redemption_value);

    // Return minimum of available balance and max allowed
    return Math.min(currentBalance, maxPointsFromBill);
}

// =============================================
// Transactions
// =============================================

/**
 * Write the points ledger row. A failure here must reach the caller: a balance
 * that moved without an audit row is exactly the drift this ledger exists to
 * prevent (CUS-5).
 */
async function recordTransaction(
    accountId: string,
    type: TransactionType,
    points: number,
    balanceAfter: number,
    description?: string,
    referenceType?: string,
    referenceId?: string,
    db: PocketBase = pb
): Promise<LoyaltyTransaction> {
    try {
        const record = await db.collection('loyalty_transactions').create({
            account_email: dbTenant(db),
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
        throw error;
    }
}

export async function earnPoints(
    customerId: string,
    purchaseAmount: number,
    referenceType: string,
    referenceId: string,
    db: PocketBase = pb
): Promise<{ pointsEarned: number; newBalance: number } | null> {
    return enqueueTask(`loyalty_${customerId}`, async () => {
        // Already inside the loyalty lock — use the unlocked helper to avoid
        // re-entering enqueueTask on the same key (deadlock).
        const account = await ensureLoyaltyAccount(customerId, db);
        if (!account) return null;

        const pointsToEarn = await calculatePointsToEarn(purchaseAmount, account.tier, db);

        if (pointsToEarn <= 0) return { pointsEarned: 0, newBalance: account.current_balance };

        try {
            // Update account atomically
            const updated = await db.collection('loyalty_accounts').update<LoyaltyAccount>(account.id, {
                'current_balance+': pointsToEarn,
                'total_points_earned+': pointsToEarn,
                'lifetime_value+': purchaseAmount,
                last_activity: new Date().toISOString(),
            });

            const newBalance = updated.current_balance;

            // Sync balance to customer record
            await db.collection('customers').update(customerId, {
                loyalty_points: newBalance,
            }).catch(() => {});

            // Record transaction
            await recordTransaction(
                account.id,
                'earn',
                pointsToEarn,
                newBalance,
                `Earned from ${referenceType}`,
                referenceType,
                referenceId,
                db
            );

            return { pointsEarned: pointsToEarn, newBalance };
        } catch (error) {
            // The balance update precedes the ledger row; swallowing here left
            // points with no audit trail (SW-13). Fail closed so the caller
            // knows the write failed. The customer mirror above stays best-effort.
            console.error('Error updating loyalty account:', error);
            throw error;
        }
    });
}

export async function redeemPoints(
    customerId: string,
    pointsToRedeem: number,
    referenceType: string,
    referenceId: string,
    billAmount?: number,
    db: PocketBase = pb
): Promise<{ redeemed: boolean; valueApplied: number; newBalance: number } | null> {
    return enqueueTask(`loyalty_${customerId}`, async () => {
        const account = await getLoyaltyAccount(customerId, db);
        if (!account) return null;

        if (!Number.isFinite(pointsToRedeem) || pointsToRedeem <= 0) {
            throw new Error('Redemption must be a positive number of points');
        }

        // Validate
        if (pointsToRedeem > account.current_balance) {
            throw new Error('Insufficient points balance');
        }

        const settings = await getLoyaltySettings(db);

        if (pointsToRedeem < settings.min_redemption_points) {
            throw new Error(`Minimum ${settings.min_redemption_points} points required for redemption`);
        }

        // The percentage cap must hold at the service boundary, not only in the
        // POS screen that happens to call it.
        if (typeof billAmount === 'number' && Number.isFinite(billAmount)) {
            const maxRedeemable = await calculateMaxRedeemablePoints(billAmount, account.current_balance);
            if (pointsToRedeem > maxRedeemable) {
                throw new Error(`At most ${maxRedeemable} points can be redeemed on this bill`);
            }
        }

        const valueApplied = await calculateRedemptionValue(pointsToRedeem);

        try {
            // Update account atomically (guarded by min: 0 constraint against negative balance)
            const updated = await db.collection('loyalty_accounts').update<LoyaltyAccount>(account.id, {
                'current_balance-': pointsToRedeem,
                'total_points_redeemed+': pointsToRedeem,
                last_activity: new Date().toISOString(),
            });

            const newBalance = updated.current_balance;

            // Sync balance to customer record
            await db.collection('customers').update(customerId, {
                loyalty_points: newBalance,
            }).catch(() => {});

            // Record transaction (negative points for redemption)
            await recordTransaction(
                account.id,
                'redeem',
                -pointsToRedeem,
                newBalance,
                `Redeemed for ${referenceType}`,
                referenceType,
                referenceId,
                db
            );

            return { redeemed: true, valueApplied, newBalance };
        } catch (error) {
            // Same fail-closed rule as earnPoints: a moved balance without its
            // ledger row must reach the caller (SW-13).
            console.error('Error redeeming loyalty points:', error);
            throw error;
        }
    });
}

export async function adjustPoints(
    customerId: string,
    pointsAdjustment: number,
    reason: string,
    _performedBy?: string,
    db: PocketBase = pb
): Promise<{ newBalance: number } | null> {
    if (!Number.isFinite(pointsAdjustment) || pointsAdjustment === 0) {
        throw new Error('Adjustment must be a non-zero number');
    }

    // Serialized with earn/redeem so the negative-balance compensation cannot
    // interleave with another balance write (CUS-10).
    return enqueueTask(`loyalty_${customerId}`, async () => {
        const account = await getLoyaltyAccount(customerId, db);
        if (!account) return null;

        try {
            // Operators, not a value read a moment ago: a concurrent earn or redeem
            // between the read and the write would otherwise be overwritten.
            const updated = await db.collection('loyalty_accounts').update<LoyaltyAccount>(account.id, {
                'current_balance+': pointsAdjustment,
                ...(pointsAdjustment > 0 && { 'total_points_earned+': pointsAdjustment }),
                last_activity: new Date().toISOString(),
            });

            const newBalance = updated.current_balance;
            if (newBalance < 0) {
                // Compensate and refuse; the pre-read cannot prove the balance.
                // A failed compensation leaves a negative balance behind, so it
                // must never be swallowed (CUS-10).
                try {
                    await db.collection('loyalty_accounts').update(account.id, {
                        'current_balance+': -pointsAdjustment,
                    });
                } catch (compensationError) {
                    console.error(
                        '[loyalty] CRITICAL: negative-balance compensation failed; manual correction required',
                        { customerId, accountId: account.id, pointsAdjustment, compensationError }
                    );
                    throw new Error(
                        `Adjustment would result in negative balance and the compensating write failed: ${
                            compensationError instanceof Error ? compensationError.message : String(compensationError)
                        }`
                    );
                }
                throw new Error('Adjustment would result in negative balance');
            }

            // Sync balance to customer record
            await db.collection('customers').update(customerId, {
                loyalty_points: newBalance,
            }).catch(() => {});

            // Record transaction
            await recordTransaction(
                account.id,
                'adjust',
                pointsAdjustment,
                newBalance,
                reason,
                'manual',
                undefined,
                db
            );

            return { newBalance };
        } catch (error) {
            console.error('Error adjusting loyalty points:', error);
            throw error;
        }
    });
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
                filter: `account="${sanitizeFilter(account.id)}"${tenantClause()}`,
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

        const totalMembersResult = await pb.collection('loyalty_accounts').getList(1, 1, {
            filter: `id != ""${tenantClause()}`,
        });
        const activeMembersResult = await pb.collection('loyalty_accounts').getList(1, 1, {
            filter: `is_active=true${tenantClause()}`,
        });

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
    } catch {
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
            filter: `is_active=true${tenantClause()}`,
            sort: '-total_points_earned',
            expand: 'tier,customer'
        });
        return records.items;
    } catch (error) {
        console.error('Error fetching top members:', error);
        return [];
    }
}
