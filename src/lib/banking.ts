/**
 * Banking & Ledger Management
 * Handles bank accounts and transactions using PocketBase
 */

import { pb } from './pocketbase';
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
// ACCOUNTS
// ==========================================

export async function getBankAccounts(): Promise<BankAccount[]> {
    try {
        const records = await pb.collection('bank_accounts').getFullList<BankAccount>({
            filter: 'is_active=true',
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
        return record;
    } catch (error) {
        console.error('Error fetching bank account:', error);
        return null;
    }
}

export async function createBankAccount(account: NewBankAccount): Promise<BankAccount> {
    try {
        const opening = Number(account.opening_balance) || 0;
        const current = account.current_balance !== undefined ? Number(account.current_balance) || 0 : opening;
        const payload = {
            ...account,
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
        const payload: Record<string, any> = { ...updates };
        if (updates.opening_balance !== undefined) {
            payload.opening_balance = Number(updates.opening_balance) || 0;
        }
        if (updates.current_balance !== undefined) {
            payload.current_balance = Number(updates.current_balance) || 0;
        }
        const record = await pb.collection('bank_accounts').update(id, payload);
        return record as unknown as BankAccount;
    } catch (error) {
        throw error;
    }
}

export async function deleteBankAccount(id: string): Promise<void> {
    // Soft delete
    try {
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
        const filter = accountId ? `account="${accountId}"` : '';
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

        // Overdraft protection: verify sufficient balance for debits
        if (transaction.type === 'withdrawal' || transaction.type === 'transfer') {
            if ((account.current_balance || 0) < transaction.amount) {
                throw new Error(`Insufficient funds: account balance (₹${account.current_balance || 0}) is less than transaction amount (₹${transaction.amount})`);
            }
        }

        let record: any = null;
        let destRecord: any = null;
        let destCredited = false;
        try {
            record = await pb.collection('bank_transactions').create(transaction);

            const balanceUpdate: Record<string, number> = {};
            if (transaction.type === 'deposit') {
                balanceUpdate['current_balance+'] = transaction.amount;
            } else if (transaction.type === 'withdrawal' || transaction.type === 'transfer') {
                balanceUpdate['current_balance-'] = transaction.amount;
            }

            await pb.collection('bank_accounts').update(transaction.account, balanceUpdate);

            // Double-entry inter-account transfer support: credit destination account when specified
            if (
                transaction.type === 'transfer' &&
                transaction.related_entity_type === 'bank_account' &&
                transaction.related_entity_id &&
                transaction.related_entity_id !== transaction.account
            ) {
                const destAccount = await getBankAccount(transaction.related_entity_id);
                if (destAccount) {
                    await pb.collection('bank_accounts').update(transaction.related_entity_id, {
                        'current_balance+': transaction.amount
                    });
                    destCredited = true;

                    // Automatically post matching deposit to destination ledger
                    destRecord = await pb.collection('bank_transactions').create({
                        account: transaction.related_entity_id,
                        transaction_date: transaction.transaction_date,
                        type: 'deposit',
                        amount: transaction.amount,
                        description: `Transfer from ${account.account_name}${transaction.description ? `: ${transaction.description}` : ''}`,
                        reference_number: transaction.reference_number,
                        related_entity_type: 'bank_account',
                        related_entity_id: transaction.account
                    });
                }
            }

            return record as unknown as BankTransaction;
        } catch (error) {
            // Compensating rollbacks: revert destination ledger and balance if partially applied
            if (destRecord?.id) {
                await pb.collection('bank_transactions').delete(destRecord.id).catch(() => {});
            }
            if (destCredited && transaction.related_entity_id) {
                await pb.collection('bank_accounts').update(transaction.related_entity_id, {
                    'current_balance-': transaction.amount
                }).catch(() => {});
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
    if (amount <= 0) {
        throw new Error('Transfer amount must be greater than zero');
    }

    const txDate = new Date().toISOString().split('T')[0];
    const sourceTx = await createBankTransaction({
        account: fromAccountId,
        transaction_date: txDate,
        type: 'transfer',
        amount,
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
    } catch (error) {
        return { totalBalance: 0, totalAccounts: 0 };
    }
}
