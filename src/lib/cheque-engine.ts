/**
 * Cheques & Post-Dated Cheques (PDC) Lifecycle Engine
 * Reverse-engineered from Vyapar BizLogic (ChequeLogic.js, ChequeStatus.js)
 * and tailored for Indian Banking Standards (CTS-2010, Section 138 NI Act, RBI 90-Day Validity).
 */

export type ChequeDirection = 'received' | 'issued';

export type ChequeStatus =
    | 'open'       // In-hand / registered, not yet presented to bank
    | 'deposited'  // Presented in bank clearing, pending settlement
    | 'cleared'    // Funds realized; reflected in bank account balance
    | 'bounced'    // Dishonored (insufficient funds, signature mismatch, etc.)
    | 'cancelled'; // Voided

export interface ChequeRecord {
    id: string;
    chequeNumber: string; // 6-digit CTS-2010 cheque number
    direction: ChequeDirection;
    partyId?: string;
    partyName: string;
    bankName: string; // Drawee bank (e.g. "HDFC Bank", "SBI")
    branchName?: string;
    chequeDate: string; // YYYY-MM-DD
    amount: number;
    status: ChequeStatus;
    depositDate?: string;
    clearingDate?: string;
    targetBankAccountId?: string;
    targetBankAccountName?: string;
    bounceReason?: string;
    bouncePenaltyCharge?: number;
    notes?: string;
    createdDate: string;
    modifiedDate: string;
}

export interface PdcMaturityInfo {
    isPdc: boolean;
    daysToMaturity: number; // Positive = days until due, Negative = past due
    isMature: boolean;
    isStale: boolean; // Over 90 days old from chequeDate (RBI 3-month rule)
    statusLabel: string;
}

export interface ChequeTransitionResult {
    success: boolean;
    previousStatus: ChequeStatus;
    newStatus: ChequeStatus;
    cheque: ChequeRecord;
    ledgerEffect: {
        bankAccountId?: string;
        bankBalanceDelta: number; // Change to bank account balance
        partyReceivableDelta: number; // Change to party receivable/payable
        bouncePenaltyApplied: number;
        description: string;
    };
    error?: string;
}

export interface ChequePortfolioSummary {
    totalCount: number;
    totalAmount: number;
    openInHandCount: number;
    openInHandAmount: number;
    pdcCount: number;
    pdcAmount: number;
    depositedPendingCount: number;
    depositedPendingAmount: number;
    clearedCount: number;
    clearedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    staleCount: number;
    staleAmount: number;
}

/**
 * Validates CTS-2010 standard Indian cheque numbers (strictly 6 numeric digits)
 */
export function isValidChequeNumber(chequeNumber?: string): boolean {
    if (!chequeNumber) return false;
    const sanitized = chequeNumber.trim();
    return /^\d{6}$/.test(sanitized);
}

/**
 * Determines PDC maturity and RBI 90-day stale status
 */
export function getPdcMaturityInfo(chequeDateStr: string, referenceDateStr: string = new Date().toISOString()): PdcMaturityInfo {
    const chequeTime = new Date(chequeDateStr.substring(0, 10)).getTime();
    const refTime = new Date(referenceDateStr.substring(0, 10)).getTime();

    if (isNaN(chequeTime) || isNaN(refTime)) {
        return {
            isPdc: false,
            daysToMaturity: 0,
            isMature: false,
            isStale: false,
            statusLabel: 'Invalid Date',
        };
    }

    const diffDays = Math.round((chequeTime - refTime) / (1000 * 60 * 60 * 24));
    const isPdc = diffDays > 0;
    const isMature = diffDays <= 0;
    // RBI 90 days validity rule: Stale if reference date is > 90 days after cheque date
    const isStale = diffDays < -90;

    let statusLabel = 'Current';
    if (isStale) {
        statusLabel = `Stale / Expired (${Math.abs(diffDays)} days old)`;
    } else if (isPdc) {
        statusLabel = `Post-Dated (Matures in ${diffDays} day${diffDays === 1 ? '' : 's'})`;
    } else {
        statusLabel = 'Ready for Clearing';
    }

    return {
        isPdc,
        daysToMaturity: diffDays,
        isMature,
        isStale,
        statusLabel,
    };
}

/**
 * Validates allowed state transitions in cheque lifecycle
 */
export function canTransitionStatus(fromStatus: ChequeStatus, toStatus: ChequeStatus): boolean {
    if (fromStatus === toStatus) return true; // Idempotent

    switch (fromStatus) {
        case 'open':
            return toStatus === 'deposited' || toStatus === 'cancelled';
        case 'deposited':
            return toStatus === 'cleared' || toStatus === 'bounced' || toStatus === 'open';
        case 'cleared':
            // Vyapar allows re-opening a cleared cheque if an operational error occurred
            return toStatus === 'open';
        case 'bounced':
            // Can be reopened for re-presentation or cancelled
            return toStatus === 'open' || toStatus === 'cancelled';
        case 'cancelled':
            return toStatus === 'open'; // Re-activate accidentally voided cheque
        default:
            return false;
    }
}

/**
 * Executes a verified lifecycle transition on a cheque
 * Calculates exact bank ledger balance delta and party adjustments.
 */
export function transitionChequeStatus(
    cheque: ChequeRecord,
    newStatus: ChequeStatus,
    options: {
        transitionDate?: string;
        targetBankAccountId?: string;
        targetBankAccountName?: string;
        bounceReason?: string;
        bouncePenaltyCharge?: number;
    } = {}
): ChequeTransitionResult {
    const fromStatus = cheque.status;

    if (!canTransitionStatus(fromStatus, newStatus)) {
        return {
            success: false,
            previousStatus: fromStatus,
            newStatus,
            cheque,
            ledgerEffect: {
                bankBalanceDelta: 0,
                partyReceivableDelta: 0,
                bouncePenaltyApplied: 0,
                description: `Illegal transition from ${fromStatus} to ${newStatus}`,
            },
            error: `Cannot transition cheque status from "${fromStatus}" to "${newStatus}".`,
        };
    }

    // Require bank account when depositing
    if (newStatus === 'deposited' && !options.targetBankAccountId && !cheque.targetBankAccountId) {
        return {
            success: false,
            previousStatus: fromStatus,
            newStatus,
            cheque,
            ledgerEffect: {
                bankBalanceDelta: 0,
                partyReceivableDelta: 0,
                bouncePenaltyApplied: 0,
                description: 'Target bank account required for deposit',
            },
            error: 'Target bank account must be specified when depositing a cheque.',
        };
    }

    let bankBalanceDelta = 0;
    let partyReceivableDelta = 0;
    let bouncePenaltyApplied = 0;
    let description = '';

    const effectiveBankId = options.targetBankAccountId || cheque.targetBankAccountId;
    const effectiveBankName = options.targetBankAccountName || cheque.targetBankAccountName;
    const nowIso = options.transitionDate || new Date().toISOString();

    // 1. Cleared
    if (newStatus === 'cleared' && fromStatus !== 'cleared') {
        if (cheque.direction === 'received') {
            bankBalanceDelta = cheque.amount; // Received cheque credits company bank
            partyReceivableDelta = 0; // Already settled when invoice was issued
            description = `Cheque #${cheque.chequeNumber} cleared: Credited ₹${cheque.amount} to ${effectiveBankName || 'bank'}`;
        } else {
            bankBalanceDelta = -cheque.amount; // Issued cheque debits company bank
            partyReceivableDelta = 0;
            description = `Cheque #${cheque.chequeNumber} cleared: Debited ₹${cheque.amount} from ${effectiveBankName || 'bank'}`;
        }
    }
    // 2. Re-opened from Cleared (Rollback realization)
    else if (fromStatus === 'cleared' && newStatus === 'open') {
        if (cheque.direction === 'received') {
            bankBalanceDelta = -cheque.amount; // Reverse credit
            description = `Cheque #${cheque.chequeNumber} re-opened: Reversed ₹${cheque.amount} credit from ${effectiveBankName || 'bank'}`;
        } else {
            bankBalanceDelta = cheque.amount; // Reverse debit
            description = `Cheque #${cheque.chequeNumber} re-opened: Restored ₹${cheque.amount} to ${effectiveBankName || 'bank'}`;
        }
    }
    // 3. Bounced
    else if (newStatus === 'bounced') {
        const penalty = Math.max(0, Number(options.bouncePenaltyCharge) || 0);
        bouncePenaltyApplied = penalty;

        if (cheque.direction === 'received') {
            // Re-instate party debt (they owe us the cheque amount again + bounce fee)
            partyReceivableDelta = cheque.amount + penalty;
            // Bank charges us penalty fee
            bankBalanceDelta = -penalty;
            description = `Cheque #${cheque.chequeNumber} BOUNCED (${options.bounceReason || 'Dishonored'}): Debited ₹${penalty} bank fee, reinstated ₹${cheque.amount + penalty} receivable on ${cheque.partyName}`;
        } else {
            // Issued cheque bounced: party payable reinstated
            partyReceivableDelta = -(cheque.amount + penalty);
            bankBalanceDelta = -penalty;
            description = `Issued Cheque #${cheque.chequeNumber} BOUNCED: Debited ₹${penalty} fee, restored payable to ${cheque.partyName}`;
        }
    }
    // 4. Deposited
    else if (newStatus === 'deposited') {
        description = `Cheque #${cheque.chequeNumber} deposited to ${effectiveBankName || 'bank'} (Awaiting clearing)`;
    }
    // 5. Cancelled
    else if (newStatus === 'cancelled') {
        description = `Cheque #${cheque.chequeNumber} cancelled / voided`;
    }

    const updatedCheque: ChequeRecord = {
        ...cheque,
        status: newStatus,
        targetBankAccountId: effectiveBankId,
        targetBankAccountName: effectiveBankName,
        depositDate: newStatus === 'deposited' ? nowIso : (newStatus === 'open' ? undefined : cheque.depositDate),
        clearingDate: newStatus === 'cleared' ? nowIso : (newStatus === 'open' ? undefined : cheque.clearingDate),
        bounceReason: newStatus === 'bounced' ? (options.bounceReason || 'Dishonored') : (newStatus === 'open' ? undefined : cheque.bounceReason),
        bouncePenaltyCharge: newStatus === 'bounced' ? bouncePenaltyApplied : (newStatus === 'open' ? undefined : cheque.bouncePenaltyCharge),
        modifiedDate: nowIso,
    };

    return {
        success: true,
        previousStatus: fromStatus,
        newStatus,
        cheque: updatedCheque,
        ledgerEffect: {
            bankAccountId: effectiveBankId,
            bankBalanceDelta: Math.round(bankBalanceDelta * 100) / 100,
            partyReceivableDelta: Math.round(partyReceivableDelta * 100) / 100,
            bouncePenaltyApplied,
            description,
        },
    };
}

/**
 * Aggregates a full cheque portfolio into operational KPIs
 */
export function aggregateChequePortfolio(
    cheques: ChequeRecord[],
    referenceDateStr: string = new Date().toISOString()
): ChequePortfolioSummary {
    let totalCount = 0;
    let totalAmount = 0;
    let openInHandCount = 0;
    let openInHandAmount = 0;
    let pdcCount = 0;
    let pdcAmount = 0;
    let depositedPendingCount = 0;
    let depositedPendingAmount = 0;
    let clearedCount = 0;
    let clearedAmount = 0;
    let bouncedCount = 0;
    let bouncedAmount = 0;
    let staleCount = 0;
    let staleAmount = 0;

    for (const c of cheques) {
        const amt = Math.max(0, Number(c.amount) || 0);
        totalCount++;
        totalAmount += amt;

        const maturity = getPdcMaturityInfo(c.chequeDate, referenceDateStr);

        if (c.status === 'open') {
            openInHandCount++;
            openInHandAmount += amt;

            if (maturity.isPdc) {
                pdcCount++;
                pdcAmount += amt;
            } else if (maturity.isStale) {
                staleCount++;
                staleAmount += amt;
            }
        } else if (c.status === 'deposited') {
            depositedPendingCount++;
            depositedPendingAmount += amt;
        } else if (c.status === 'cleared') {
            clearedCount++;
            clearedAmount += amt;
        } else if (c.status === 'bounced') {
            bouncedCount++;
            bouncedAmount += amt;
        }
    }

    return {
        totalCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        openInHandCount,
        openInHandAmount: Math.round(openInHandAmount * 100) / 100,
        pdcCount,
        pdcAmount: Math.round(pdcAmount * 100) / 100,
        depositedPendingCount,
        depositedPendingAmount: Math.round(depositedPendingAmount * 100) / 100,
        clearedCount,
        clearedAmount: Math.round(clearedAmount * 100) / 100,
        bouncedCount,
        bouncedAmount: Math.round(bouncedAmount * 100) / 100,
        staleCount,
        staleAmount: Math.round(staleAmount * 100) / 100,
    };
}
