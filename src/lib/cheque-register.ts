/**
 * Cheque / post-dated cheque register.
 *
 * `cheque-engine.ts` implements the PDC lifecycle, maturity maths and ledger
 * effects, but had no importer and no collection. This module gives it a
 * register in the existing `store_settings` key/value table under
 * `cheque_register` (no migration), and the page drives the engine's state
 * machine so illegal transitions are refused with the engine's own message.
 */

import { pb } from './pocketbase';
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

async function readCheques(): Promise<ChequeRecord[]> {
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(`key="${SETTINGS_KEY}"`)
        .catch(() => null);
    if (!row) return [];
    return parseCheques(row.value);
}

async function writeCheques(cheques: ChequeRecord[]): Promise<void> {
    const value = JSON.stringify(cheques);
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(`key="${SETTINGS_KEY}"`)
        .catch(() => null);

    if (row) {
        await pb.collection('store_settings').update(row.id, { value });
    } else {
        await pb.collection('store_settings').create({
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

    await writeCheques([record, ...existing].slice(0, MAX_CHEQUES));
    return listCheques();
}

export async function advanceCheque(
    id: string,
    status: ChequeStatus,
    options: ChequeTransitionOptions = {}
): Promise<{ cheques: ChequeRecord[]; result: ChequeTransitionResult }> {
    const cheques = await readCheques();
    const index = cheques.findIndex((cheque) => cheque.id === id);
    if (index < 0) throw new Error('Cheque not found.');

    const result = transitionChequeStatus(cheques[index], status, options);
    if (!result.success) throw new Error(result.error || 'That status change is not allowed.');

    cheques[index] = result.cheque;
    await writeCheques(cheques);
    return { cheques: sortCheques(cheques), result };
}

export async function deleteCheque(id: string): Promise<ChequeRecord[]> {
    const cheques = await readCheques();
    const target = cheques.find((cheque) => cheque.id === id);
    if (!target) throw new Error('Cheque not found.');
    if (target.status === 'cleared') {
        throw new Error('A cleared cheque is part of the bank audit trail and cannot be deleted.');
    }
    await writeCheques(cheques.filter((cheque) => cheque.id !== id));
    return listCheques();
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
