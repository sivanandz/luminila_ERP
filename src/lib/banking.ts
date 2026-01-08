/**
 * Banking & Ledger Management
 * Handles bank accounts and transactions using PocketBase
 */

import { pb } from './pocketbase';

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
        const record = await pb.collection('bank_accounts').create(account);
        return record as unknown as BankAccount;
    } catch (error) {
        throw error;
    }
}

export async function updateBankAccount(id: string, updates: Partial<BankAccount>): Promise<BankAccount> {
    try {
        const record = await pb.collection('bank_accounts').update(id, updates);
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
    try {
        const record = await pb.collection('bank_transactions').create(transaction);

        // Note: In Supabase we had triggers to update balance.
        // In PocketBase, we don't have triggers yet unless we use Go hooks.
        // So we MUST update the balance manually here or in a helper.

        await updateAccountBalance(transaction.account, transaction.type, transaction.amount);

        return record as unknown as BankTransaction;
    } catch (error) {
        throw error;
    }
}

// Helper to update balance manually since no DB triggers in PB (JS SDK)
async function updateAccountBalance(accountId: string, type: string, amount: number) {
    const account = await getBankAccount(accountId);
    if (!account) return;

    let newBalance = account.current_balance;
    if (type === 'deposit') {
        newBalance += amount;
    } else if (type === 'withdrawal' || type === 'transfer') {
        newBalance -= amount;
    }

    await pb.collection('bank_accounts').update(accountId, {
        current_balance: newBalance
    });
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
