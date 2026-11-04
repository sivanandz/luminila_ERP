/**
 * Banking & Ledger Management
 * Handles bank accounts and transactions using PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';
import { enqueueTask } from './concurrency';

// ==========================================
// TYPES
// ==========================================

export interface BankAccount {
    id: string;
    account_name: string;
    account_number?: string;
    bank_name?: string;
    ifsc_code?: string;
    currency?: string;
    opening_balance: number;
    current_balance: number;
    is_active: boolean;
    account_email?: string;
    created: string;
    updated: string;
}

export interface BankTransaction {
    id: string;
    account: string; // Relation
    transaction_date: string;
    type: 'deposit' | 'withdrawal' | 'transfer';
    amount: number;
    description?: string;
    reference_number?: string;
    related_entity_type?: string;
    related_entity_id?: string;
    created: string;
    // Expanded
    expand?: {
        account?: {
            account_name: string;
        };
    };
}

export type NewBankAccount = {
    account_name: string;
    account_number?: string;
    bank_name?: string;
    ifsc_code?: string;
    currency?: string;
    opening_balance?: number;
    current_balance?: number;
    is_active?: boolean;
};

export type NewBankTransaction = {
    account: string; // ID
    transaction_date: string;
    type: 'deposit' | 'withdrawal' | 'transfer';
    amount: number;
    description?: string;
    reference_number?: string;
    related_entity_type?: string;
    related_entity_id?: string;
};

// ==========================================
// TENANT SCOPING (FIN-01)
// ==========================================

/** `account_email="…"` filter for the signed-in tenant; always non-empty. */
function tenantFilter(): string {
    return `account_email="${sanitizeFilter(accountScopeEmail())}"`;
}

function joinFilter(...parts: string[]): string {
    return parts.filter(Boolean).join(' && ');
}

/** Money is stored in rupees with at most two decimals (BNK-13). */
function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Ownership check for records read by id (getOne/update cannot take a filter).
 * Legacy rows without a stamp are treated as the single account's, matching
 * the collection rules.
 */
function recordBelongsToScope(record: { account_email?: string } | null | undefined): boolean {
    if (!record) return false;
    const recordTenant = String(record.account_email || '').trim().toLowerCase();
    return !recordTenant || recordTenant === accountScopeEmail();
}

// ==========================================
// ACCOUNTS
// ==========================================

export async function getBankAccounts(): Promise<BankAccount[]> {
    try {
        const records = await pb.collection('bank_accounts').getFullList<BankAccount>({
            filter: joinFilter('is_active=true', tenantFilter()),
            sort: 'account_name'
        });
        return records;
    } catch (error) {
        console.error('Error fetching bank accounts:', error);
        return [];
    }
}

export async function getBankAccount(id: string): Promise<BankAccount | null> {
    try {
        const record = await pb.collection('bank_accounts').getOne<BankAccount>(id);
        // getOne has no filter, so ownership is verified in memory before the
        // account can be read, debited or credited (FIN-01).
        if (!recordBelongsToScope(record)) return null;
        return record;
    } catch (error) {
        console.error('Error fetching bank account:', error);
        return null;
    }
}

export async function createBankAccount(account: NewBankAccount): Promise<BankAccount> {
    try {
        const opening = round2(Number(account.opening_balance) || 0);
        const current = account.current_balance !== undefined ? round2(Number(account.current_balance) || 0) : opening;
        const payload = {
            ...account,
            account_email: accountScopeEmail(),
            opening_balance: opening,
            current_balance: current,
            is_active: account.is_active ?? true,
        };
        const record = await pb.collection('bank_accounts').create(payload);
        return record as unknown as BankAccount;
    } catch (error) {
        throw error;
    }
}

export async function updateBankAccount(id: string, updates: Partial<BankAccount>): Promise<BankAccount> {
    try {
        // Refuse updates to an account owned by another tenant (FIN-01).
        const existing = await getBankAccount(id);
        if (!existing) {
            throw new Error('Bank account not found');
        }
        const payload: Record<string, unknown> = { ...updates };
        delete payload.account_email;
        // Balances are ledger-derived: accepting them here bypassed the
        // overdraft guard and double-entry entirely. All movements must go
        // through createBankTransaction/transferFunds (BNK-8).
        delete payload.current_balance;
        delete payload.opening_balance;
        const record = await pb.collection('bank_accounts').update(id, payload);
        return record as unknown as BankAccount;
    } catch (error) {
        throw error;
    }
}

export async function deleteBankAccount(id: string): Promise<void> {
    // Soft delete
    try {
        const existing = await getBankAccount(id);
        if (!existing) {
            throw new Error('Bank account not found');
        }
        await pb.collection('bank_accounts').update(id, { is_active: false });
    } catch (error) {
        throw error;
    }
}

// ==========================================
// TRANSACTIONS
// ==========================================

export async function getBankTransactions(
    accountId?: string,
    limit: number = 50
): Promise<BankTransaction[]> {
    try {
        const filter = joinFilter(
            tenantFilter(),
            accountId ? `account="${sanitizeFilter(accountId)}"` : ''
        );
        const records = await pb.collection('bank_transactions').getList<BankTransaction>(1, limit, {
            filter,
            sort: '-transaction_date,-created',
            expand: 'account'
        });
        return records.items;
    } catch (error) {
        console.error('Error fetching transactions:', error);
        return [];
    }
}

export async function createBankTransaction(transaction: NewBankTransaction): Promise<BankTransaction> {
    return enqueueTask(`bank_${transaction.account}`, async () => {
        const account = await getBankAccount(transaction.account);
        if (!account) {
            throw new Error(`Bank account ${transaction.account} not found`);
        }

        // A negative or non-finite amount would bypass the overdraft check and
        // increase the balance instead of decreasing it (FIN-12). Paise are
        // capped at two decimals so balance modifiers do not accumulate drift
        // (BNK-13).
        const amount = round2(Number(transaction.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Transaction amount must be a positive number');
        }

        // Overdraft protection: verify sufficient balance for debits
        if (transaction.type === 'withdrawal' || transaction.type === 'transfer') {
            if ((account.current_balance || 0) < amount) {
                throw new Error(`Insufficient funds: account balance (₹${account.current_balance || 0}) is less than transaction amount (₹${amount})`);
            }
        }

        let record: BankTransaction | null = null;
        let destRecord: BankTransaction | null = null;
        let destCredited = false;
        let sourceUpdated = false;
        try {
            record = await pb.collection('bank_transactions').create<BankTransaction>({
                ...transaction,
                amount,
                account_email: accountScopeEmail(),
            });

            const balanceUpdate: Record<string, number> = {};
            if (transaction.type === 'deposit') {
                balanceUpdate['current_balance+'] = amount;
            } else if (transaction.type === 'withdrawal' || transaction.type === 'transfer') {
                balanceUpdate['current_balance-'] = amount;
            }

            await pb.collection('bank_accounts').update(transaction.account, balanceUpdate);
            sourceUpdated = true;

            // The overdraft guard above is only a pre-read: another tab or
            // process can debit between the check and this atomic decrement
            // (BNK-2). Re-read after the write and undo it when the account
            // went negative, so the ledger row never survives an overdraft.
            if (transaction.type === 'withdrawal' || transaction.type === 'transfer') {
                const after = await pb.collection('bank_accounts').getOne<BankAccount>(transaction.account);
                if (Number(after.current_balance) < 0) {
                    await pb.collection('bank_accounts').update(transaction.account, {
                        'current_balance+': amount,
                    });
                    sourceUpdated = false;
                    throw new Error(
                        `Insufficient funds: account balance went negative after this transaction (₹${after.current_balance})`
                    );
                }
            }

            // Double-entry inter-account transfer support: credit destination account when specified
            if (
                transaction.type === 'transfer' &&
                transaction.related_entity_type === 'bank_account' &&
                transaction.related_entity_id &&
                transaction.related_entity_id !== transaction.account
            ) {
                const destAccount = await getBankAccount(transaction.related_entity_id);
                // Skipping a missing destination debited the source and never
                // credited anyone. Throw so the source is rolled back (FIN-05).
                if (!destAccount) {
                    throw new Error(`Destination bank account ${transaction.related_entity_id} not found; transfer rolled back`);
                }
                await pb.collection('bank_accounts').update(transaction.related_entity_id, {
                    'current_balance+': amount
                });
                destCredited = true;

                // Automatically post matching deposit to destination ledger
                destRecord = await pb.collection('bank_transactions').create<BankTransaction>({
                    account: transaction.related_entity_id,
                    transaction_date: transaction.transaction_date,
                    type: 'deposit',
                    amount,
                    description: `Transfer from ${account.account_name}${transaction.description ? `: ${transaction.description}` : ''}`,
                    reference_number: transaction.reference_number,
                    related_entity_type: 'bank_account',
                    related_entity_id: transaction.account,
                    account_email: accountScopeEmail(),
                });
            }

            return record as unknown as BankTransaction;
        } catch (error) {
            // Compensating rollbacks: revert destination ledger and balance if partially applied
            if (destRecord?.id) {
                await pb.collection('bank_transactions').delete(destRecord.id).catch(() => {});
            }
            if (destCredited && transaction.related_entity_id) {
                await pb.collection('bank_accounts').update(transaction.related_entity_id, {
                    'current_balance-': amount
                }).catch(() => {});
            }
            // The source was debited before the failure; reverse it or the
            // account loses money that no transaction records (FIN-03).
            if (sourceUpdated) {
                const reversal: Record<string, number> = transaction.type === 'deposit'
                    ? { 'current_balance-': amount }
                    : { 'current_balance+': amount };
                await pb.collection('bank_accounts').update(transaction.account, reversal).catch((revErr) => {
                    console.error('Failed to reverse source account balance after transfer failure:', revErr);
                });
            }
            if (record?.id) {
                await pb.collection('bank_transactions').delete(record.id).catch((delErr) => {
                    console.error('Failed to rollback orphaned bank transaction:', delErr);
                });
            }
            throw error;
        }
    });
}

export async function transferFunds(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    description?: string,
    referenceNumber?: string
): Promise<{ sourceTx: BankTransaction }> {
    if (fromAccountId === toAccountId) {
        throw new Error('Source and destination accounts cannot be identical');
    }
    const transferAmount = round2(Number(amount));
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
        throw new Error('Transfer amount must be greater than zero');
    }

    const txDate = new Date().toISOString().split('T')[0];
    const sourceTx = await createBankTransaction({
        account: fromAccountId,
        transaction_date: txDate,
        type: 'transfer',
        amount: transferAmount,
        description: description || `Transfer to account ${toAccountId}`,
        reference_number: referenceNumber,
        related_entity_type: 'bank_account',
        related_entity_id: toAccountId
    });

    return { sourceTx };
}

// ==========================================
// STATS
// ==========================================

export async function getBankingStats(): Promise<{
    totalBalance: number;
    totalAccounts: number;
}> {
    try {
        const accounts = await getBankAccounts();
        const totalBalance = accounts.reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
        return {
            totalBalance,
            totalAccounts: accounts.length
        };
    } catch {
        return { totalBalance: 0, totalAccounts: 0 };
    }
}
