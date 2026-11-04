/**
 * Cheque / post-dated cheque register.
 *
 * `cheque-engine.ts` implements the PDC lifecycle, maturity maths and ledger
 * effects, but had no importer and no collection. This module gives it a
 * register in the existing `store_settings` key/value table under
 * `cheque_register` (no migration), and the page drives the engine's state
 * machine so illegal transitions are refused with the engine's own message.
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';
import { enqueueTask } from './concurrency';
import { createBankTransaction } from './banking';
import {
    aggregateChequePortfolio,
    getPdcMaturityInfo,
    isValidChequeNumber,
    transitionChequeStatus,
    type ChequeDirection,
    type ChequePortfolioSummary,
    type ChequeRecord,
    type ChequeStatus,
    type ChequeTransitionResult,
    type PdcMaturityInfo,
} from './cheque-engine';

const SETTINGS_KEY = 'cheque_register';
const MAX_CHEQUES = 500;

export interface NewChequeInput {
    chequeNumber: string;
    direction: ChequeDirection;
    partyName: string;
    bankName: string;
    branchName?: string;
    chequeDate: string;
    amount: number;
    notes?: string;
}

export interface ChequeTransitionOptions {
    transitionDate?: string;
    targetBankAccountId?: string;
    targetBankAccountName?: string;
    bounceReason?: string;
    bouncePenaltyCharge?: number;
}

/** Pure validation, so the same rule is testable without a database. */
export function validateChequeInput(input: NewChequeInput): string[] {
    const errors: string[] = [];
    if (!isValidChequeNumber(input.chequeNumber)) {
        errors.push('Cheque number must be exactly six digits.');
    }
    if (!input.partyName || !input.partyName.trim()) {
        errors.push('Party name is required.');
    }
    if (!input.bankName || !input.bankName.trim()) {
        errors.push('Bank name is required.');
    }
    if (!input.chequeDate) {
        errors.push('Cheque date is required.');
    }
    if (!(input.amount > 0)) {
        errors.push('Amount must be greater than zero.');
    }
    return errors;
}

function parseCheques(value: unknown): ChequeRecord[] {
    let raw: unknown = value;
    if (typeof value === 'string') {
        try {
            raw = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is ChequeRecord =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as ChequeRecord).id === 'string'
    );
}

function sortCheques(cheques: ChequeRecord[]): ChequeRecord[] {
    return [...cheques].sort((a, b) => (a.chequeDate < b.chequeDate ? 1 : -1));
}

/** Tenant-scoped key filter for the shared `store_settings` table (FIN-02). */
function settingsFilter(): string {
    const tenant = accountScopeEmail();
    return tenant
        ? `key="${SETTINGS_KEY}" && account_email="${sanitizeFilter(tenant)}"`
        : `key="${SETTINGS_KEY}"`;
}

async function readCheques(): Promise<ChequeRecord[]> {
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(settingsFilter())
        .catch(() => null);
    if (!row) return [];
    return parseCheques(row.value);
}

async function writeCheques(cheques: ChequeRecord[]): Promise<void> {
    const value = JSON.stringify(cheques);
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(settingsFilter())
        .catch(() => null);

    if (row) {
        await pb.collection('store_settings').update(row.id, {
            value,
            account_email: accountScopeEmail(),
        });
    } else {
        await pb.collection('store_settings').create({
            account_email: accountScopeEmail(),
            key: SETTINGS_KEY,
            value,
            category: 'banking',
        });
    }
}

export async function listCheques(): Promise<ChequeRecord[]> {
    return sortCheques(await readCheques());
}

export async function addCheque(input: NewChequeInput): Promise<ChequeRecord[]> {
    const errors = validateChequeInput(input);
    if (errors.length > 0) throw new Error(errors[0]);

    // Serialize read-modify-write on the shared JSON array; two tabs adding a
    // cheque at once could otherwise overwrite each other (FIN-17).
    return enqueueTask('cheque_register', async () => {
        const now = new Date().toISOString();
        const record: ChequeRecord = {
            id: `chq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            chequeNumber: input.chequeNumber.trim(),
            direction: input.direction,
            partyName: input.partyName.trim(),
            bankName: input.bankName.trim(),
            branchName: input.branchName?.trim(),
            chequeDate: input.chequeDate,
            amount: Math.round(input.amount * 100) / 100,
            status: 'open',
            notes: input.notes?.trim(),
            createdDate: now,
            modifiedDate: now,
        };

        const existing = await readCheques();
        if (existing.some((cheque) => cheque.chequeNumber === record.chequeNumber && cheque.bankName === record.bankName)) {
            throw new Error('That cheque number already exists for this bank.');
        }

        // Prune only cancelled history. The old `slice(0, MAX_CHEQUES)` silently
        // evicted the oldest open/cleared cheques, which are audit records (FIN-17).
        const merged = [record, ...existing];
        const active = merged.filter((cheque) => cheque.status !== 'cancelled');
        const cancelled = merged.filter((cheque) => cheque.status === 'cancelled');
        const keepCancelled = Math.max(0, MAX_CHEQUES - active.length);
        await writeCheques([...active, ...cancelled.slice(0, keepCancelled)]);
        return listCheques();
    });
}

export async function advanceCheque(
    id: string,
    status: ChequeStatus,
    options: ChequeTransitionOptions = {}
): Promise<{ cheques: ChequeRecord[]; result: ChequeTransitionResult }> {
    return enqueueTask('cheque_register', async () => {
        const cheques = await readCheques();
        const index = cheques.findIndex((cheque) => cheque.id === id);
        if (index < 0) throw new Error('Cheque not found.');

        const result = transitionChequeStatus(cheques[index], status, options);
        if (!result.success) throw new Error(result.error || 'That status change is not allowed.');

        // Commit the register transition FIRST. The state machine is itself the
        // idempotency guard (a cheque already cleared cannot be cleared again),
        // so a failed ledger post can be retried from the previous state without
        // double-posting. Posting the ledger first left money in the bank ledger
        // with no cheque transition on a write failure (BNK-1).
        const previous = cheques[index];
        cheques[index] = result.cheque;
        await writeCheques(cheques);

        const { bankBalanceDelta, bankAccountId, description } = result.ledgerEffect;
        if (bankBalanceDelta !== 0 && bankAccountId) {
            const transactionDate = (options.transitionDate || new Date().toISOString()).slice(0, 10);
            try {
                await createBankTransaction({
                    account: bankAccountId,
                    transaction_date: transactionDate,
                    type: bankBalanceDelta > 0 ? 'deposit' : 'withdrawal',
                    amount: Math.abs(bankBalanceDelta),
                    description: description || `Cheque #${result.cheque.chequeNumber}`,
                    reference_number: result.cheque.chequeNumber,
                    related_entity_type: 'cheque',
                    related_entity_id: result.cheque.id,
                });
            } catch (ledgerErr) {
                // Roll the register back so the cheque and the bank ledger agree;
                // the caller can retry the whole transition.
                const reverted = await readCheques();
                const revertIndex = reverted.findIndex((cheque) => cheque.id === id);
                if (revertIndex >= 0) {
                    reverted[revertIndex] = previous;
                    await writeCheques(reverted).catch((rollbackErr) =>
                        console.error('Cheque register rollback failed:', rollbackErr)
                    );
                }
                throw ledgerErr;
            }
        }

        return { cheques: sortCheques(cheques), result };
    });
}

export async function deleteCheque(id: string): Promise<ChequeRecord[]> {
    // Same read-modify-write serialization as add/advance (FIN-17).
    return enqueueTask('cheque_register', async () => {
        const cheques = await readCheques();
        const target = cheques.find((cheque) => cheque.id === id);
        if (!target) throw new Error('Cheque not found.');
        if (target.status === 'cleared' || target.status === 'deposited') {
            throw new Error('A deposited or cleared cheque is in active banking clearing and cannot be deleted.');
        }
        const remaining = cheques.filter((cheque) => cheque.id !== id);
        await writeCheques(remaining);
        return sortCheques(remaining);
    });
}

export function summariseCheques(
    cheques: ChequeRecord[],
    referenceDate: string = new Date().toISOString()
): ChequePortfolioSummary {
    return aggregateChequePortfolio(cheques, referenceDate);
}

export function maturityOf(cheque: ChequeRecord, referenceDate: string = new Date().toISOString()): PdcMaturityInfo {
    return getPdcMaturityInfo(cheque.chequeDate, referenceDate);
}
