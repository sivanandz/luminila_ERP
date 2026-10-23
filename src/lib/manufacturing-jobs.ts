/**
 * Karigar job costing and storage.
 *
 * `manufacturing-engine.ts` has been complete and unreachable since the first
 * commit. This module turns it into a real workflow: a job card computes raw
 * metal, additional charges, scrap credit and the metal-loss reconciliation,
 * and the results are stored in the existing `store_settings` key/value table
 * under `manufacturing_jobs`, so no migration is needed.
 */

import { pb } from './pocketbase';
import {
    calculateRawMaterialsCost,
    calculateTotalAdditionalCosts,
    reconcileMetalBalance,
    type ManufacturingAdditionalCosts,
    type MetalLossReconciliation,
    type RawMaterialInput,
} from './manufacturing-engine';

const SETTINGS_KEY = 'manufacturing_jobs';

export interface KarigarJobInput {
    karigarName: string;
    productName: string;
    metalGrams: number;
    purityKarat: string;
    ratePerGram: number;
    finishedNetGrams: number;
    scrapGrams: number;
    labour: number;
    hallmarking: number;
    finishing: number;
    logistics: number;
    certification: number;
    tolerancePercent: number;
    notes?: string;
}

export interface KarigarJobCost {
    rawMaterialCost: number;
    additionalCosts: number;
    grossProductionCost: number;
    scrapCredit: number;
    netProductionCost: number;
    perGramCost: number;
    reconciliation: MetalLossReconciliation;
}

export type KarigarJobStatus = 'in_progress' | 'completed';

export interface KarigarJobRecord extends KarigarJobInput {
    id: string;
    jobNumber: string;
    status: KarigarJobStatus;
    createdAt: string;
    completedAt?: string;
    cost: KarigarJobCost;
}

function round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function costInputs(input: KarigarJobInput) {
    const materials: RawMaterialInput[] = [
        {
            variantId: 'raw-metal',
            name: `${input.purityKarat} metal`,
            materialType: 'gold_bullion',
            quantity: Math.max(0, input.metalGrams),
            unit: 'g',
            purityKarat: input.purityKarat,
            unitCostPrice: Math.max(0, input.ratePerGram),
        },
    ];

    const additional: ManufacturingAdditionalCosts = {
        ac1_labour: input.labour,
        ac2_hallmarking: input.hallmarking,
        ac3_finishing: input.finishing,
        ac4_logistics: input.logistics,
        ac5_certification_other: input.certification,
    };

    const finished = [{
        variantId: 'finished-item',
        productName: input.productName || 'Finished piece',
        quantityProduced: 1,
        grossWeightGrams: Math.max(0, input.finishedNetGrams),
        netWeightGrams: Math.max(0, input.finishedNetGrams),
        purityKarat: input.purityKarat,
    }];

    const scrap = [{
        name: 'Recovered scrap',
        recoveredWeightGrams: Math.max(0, input.scrapGrams),
        purityKarat: input.purityKarat,
        valuationRatePerGram: Math.max(0, input.ratePerGram),
    }];

    return { materials, additional, finished, scrap };
}

/** Pure costing, so the same numbers can be tested and printed. */
export function computeKarigarJobCost(input: KarigarJobInput): KarigarJobCost {
    const { materials, additional, finished, scrap } = costInputs(input);

    const rawMaterialCost = calculateRawMaterialsCost(materials);
    const additionalCosts = calculateTotalAdditionalCosts(additional);
    const grossProductionCost = round(rawMaterialCost + additionalCosts);
    const scrapCredit = round(
        Math.max(0, input.scrapGrams) * Math.max(0, input.ratePerGram)
    );
    const netProductionCost = round(grossProductionCost - scrapCredit);
    const perGramCost = input.finishedNetGrams > 0
        ? round(netProductionCost / input.finishedNetGrams)
        : 0;

    const reconciliation = reconcileMetalBalance(
        materials,
        finished,
        scrap,
        input.tolerancePercent > 0 ? input.tolerancePercent : 1
    );

    return {
        rawMaterialCost,
        additionalCosts,
        grossProductionCost,
        scrapCredit,
        netProductionCost,
        perGramCost,
        reconciliation,
    };
}

function parseJobs(value: unknown): KarigarJobRecord[] {
    let raw: unknown = value;
    if (typeof value === 'string') {
        try {
            raw = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is KarigarJobRecord =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as KarigarJobRecord).id === 'string'
    );
}

async function readJobs(): Promise<KarigarJobRecord[]> {
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(`key="${SETTINGS_KEY}"`)
        .catch(() => null);
    if (!row) return [];
    return parseJobs(row.value);
}

async function writeJobs(jobs: KarigarJobRecord[]): Promise<void> {
    const value = JSON.stringify(jobs);
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
            category: 'manufacturing',
        });
    }
}

export function nextJobNumber(existing: KarigarJobRecord[], date = new Date()): string {
    // Business day, not UTC: a job opened at 01:00 IST belongs to that date.
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const todays = existing.filter((job) => job.jobNumber.includes(`-${stamp}-`)).length;
    return `MJ-${stamp}-${String(todays + 1).padStart(3, '0')}`;
}

export async function listKarigarJobs(): Promise<KarigarJobRecord[]> {
    const jobs = await readJobs();
    return jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveKarigarJob(input: KarigarJobInput): Promise<KarigarJobRecord[]> {
    if (!input.karigarName.trim()) throw new Error('Karigar name is required.');
    if (!input.productName.trim()) throw new Error('Piece description is required.');
    if (input.metalGrams <= 0) throw new Error('Metal issued must be greater than zero grams.');

    const jobs = await readJobs();
    const record: KarigarJobRecord = {
        ...input,
        id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        jobNumber: nextJobNumber(jobs),
        status: 'in_progress',
        createdAt: new Date().toISOString(),
        cost: computeKarigarJobCost(input),
    };

    await writeJobs([record, ...jobs].slice(0, 500));
    return listKarigarJobs();
}

export async function setKarigarJobStatus(
    id: string,
    status: KarigarJobStatus
): Promise<KarigarJobRecord[]> {
    const jobs = await readJobs();
    const next = jobs.map((job) =>
        job.id === id
            ? {
                ...job,
                status,
                completedAt: status === 'completed' ? new Date().toISOString() : undefined,
            }
            : job
    );
    await writeJobs(next);
    return listKarigarJobs();
}

export async function deleteKarigarJob(id: string): Promise<KarigarJobRecord[]> {
    const jobs = await readJobs();
    await writeJobs(jobs.filter((job) => job.id !== id));
    return listKarigarJobs();
}
