/**
 * BRUTAL VERIFICATION TEST SUITE: Phase 3 - Cheques & Post-Dated Cheques (PDC) Lifecycle Engine
 */

import {
    isValidChequeNumber,
    getPdcMaturityInfo,
    canTransitionStatus,
    transitionChequeStatus,
    aggregateChequePortfolio,
    ChequeRecord,
} from '../lib/cheque-engine';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS: ${testName}`);
    } else {
        console.error(`  ✗ FAIL: ${testName}`);
        if (detail) console.error(`    Detail: ${detail}`);
    }
}

console.log('\n============================================================');
console.log('BRUTALLY TESTING: Phase 3 Cheques & PDC Lifecycle Engine');
console.log('============================================================\n');

// -------------------------------------------------------------------------
// TEST 1: CTS-2010 6-Digit Cheque Number Validation
// -------------------------------------------------------------------------
console.log('Suite 1: CTS-2010 Cheque Number Validation');
{
    assert(isValidChequeNumber('000124') === true, 'Accepts valid 6-digit cheque number "000124"');
    assert(isValidChequeNumber('987654') === true, 'Accepts valid 6-digit cheque number "987654"');
    assert(isValidChequeNumber('12345') === false, 'Rejects 5-digit number "12345"');
    assert(isValidChequeNumber('1234567') === false, 'Rejects 7-digit number "1234567"');
    assert(isValidChequeNumber('CHQ001') === false, 'Rejects alphanumeric string "CHQ001"');
    assert(isValidChequeNumber('') === false, 'Rejects empty string');
    assert(isValidChequeNumber(undefined) === false, 'Rejects undefined input');
}

// -------------------------------------------------------------------------
// TEST 2: Post-Dated Cheque (PDC) Maturity & RBI 90-Day Rule
// -------------------------------------------------------------------------
console.log('\nSuite 2: PDC Maturity & RBI 90-Day Stale Cheque Calculation');
{
    const today = '2026-10-13';

    // 1. Future PDC (Matures in 15 days)
    const futurePdc = getPdcMaturityInfo('2026-10-28', today);
    assert(futurePdc.isPdc === true, 'Future date (2026-10-28) recognized as PDC');
    assert(futurePdc.isMature === false, 'Future date is not yet mature');
    assert(futurePdc.daysToMaturity === 15, 'Maturity is exactly in 15 days', `Got ${futurePdc.daysToMaturity}`);
    assert(futurePdc.isStale === false, 'Future date is not stale');

    // 2. Same day cheque (Current)
    const currentCheque = getPdcMaturityInfo('2026-10-13', today);
    assert(currentCheque.isPdc === false, 'Current date is not PDC');
    assert(currentCheque.isMature === true, 'Current date is mature / ready for presentation');
    assert(currentCheque.daysToMaturity === 0, 'Days to maturity is 0');
    assert(currentCheque.isStale === false, 'Current date is not stale');

    // 3. 45 days old cheque (Valid under RBI 3-month rule)
    const validPastCheque = getPdcMaturityInfo('2026-08-29', today);
    assert(validPastCheque.isMature === true, 'Past cheque within 90 days is mature');
    assert(validPastCheque.isStale === false, '45 days old cheque is NOT stale');

    // 4. 100 days old cheque (> 90 days - STALE under RBI Section 138)
    const staleCheque = getPdcMaturityInfo('2026-07-01', today);
    assert(staleCheque.isStale === true, '100+ days old cheque recognized as STALE / Expired');
    assert(staleCheque.daysToMaturity < -90, 'Negative days exceeds 90 days');
}

// -------------------------------------------------------------------------
// TEST 3: Allowed State Machine Transitions
// -------------------------------------------------------------------------
console.log('\nSuite 3: State Machine Guardrails');
{
    assert(canTransitionStatus('open', 'deposited') === true, 'Allow: open -> deposited');
    assert(canTransitionStatus('open', 'cancelled') === true, 'Allow: open -> cancelled');
    assert(canTransitionStatus('open', 'cleared') === false, 'Reject: open -> cleared (Must deposit first)');
    assert(canTransitionStatus('open', 'bounced') === false, 'Reject: open -> bounced (Cannot bounce without deposit)');

    assert(canTransitionStatus('deposited', 'cleared') === true, 'Allow: deposited -> cleared');
    assert(canTransitionStatus('deposited', 'bounced') === true, 'Allow: deposited -> bounced');
    assert(canTransitionStatus('deposited', 'open') === true, 'Allow: deposited -> open (Reopen to in-hand)');

    assert(canTransitionStatus('cleared', 'open') === true, 'Allow: cleared -> open (Reopen / operational rollback)');
    assert(canTransitionStatus('cleared', 'bounced') === false, 'Reject: cleared -> bounced (Cannot directly bounce cleared funds)');

    assert(canTransitionStatus('bounced', 'open') === true, 'Allow: bounced -> open (Re-presentation)');
    assert(canTransitionStatus('bounced', 'cancelled') === true, 'Allow: bounced -> cancelled');

    assert(canTransitionStatus('cancelled', 'open') === true, 'Allow: cancelled -> open');
    assert(canTransitionStatus('cancelled', 'cleared') === false, 'Reject: cancelled -> cleared');
}

// -------------------------------------------------------------------------
// TEST 4: Happy Path Lifecycle (Received Cheque: Open -> Deposited -> Cleared)
// -------------------------------------------------------------------------
console.log('\nSuite 4: Received Cheque Lifecycle & Bank Balance Realization');
{
    const cheque: ChequeRecord = {
        id: 'chq-001',
        chequeNumber: '000341',
        direction: 'received',
        partyName: 'Rajesh Sharma',
        bankName: 'HDFC Bank',
        chequeDate: '2026-10-10',
        amount: 85000,
        status: 'open',
        createdDate: '2026-10-10T10:00:00Z',
        modifiedDate: '2026-10-10T10:00:00Z',
    };

    // Step 1: Deposit (requires bank account)
    const depositFail = transitionChequeStatus(cheque, 'deposited');
    assert(!depositFail.success, 'Fails deposit without specifying bank account');

    const depositResult = transitionChequeStatus(cheque, 'deposited', {
        targetBankAccountId: 'bank-acc-sbi',
        targetBankAccountName: 'State Bank Current A/C',
        transitionDate: '2026-10-11T11:00:00Z',
    });
    assert(depositResult.success === true, 'Successfully deposited to SBI account');
    assert(depositResult.cheque.status === 'deposited', 'Status updated to "deposited"');
    assert(depositResult.ledgerEffect.bankBalanceDelta === 0, 'No bank balance change until realization in clearing');

    // Step 2: Clear
    const clearResult = transitionChequeStatus(depositResult.cheque, 'cleared', {
        transitionDate: '2026-10-12T14:30:00Z',
    });
    assert(clearResult.success === true, 'Successfully cleared');
    assert(clearResult.cheque.status === 'cleared', 'Status is "cleared"');
    assert(clearResult.ledgerEffect.bankBalanceDelta === 85000, 'Bank account credited by ₹85,000 on realization');

    // Step 3: Reopen (Operational error correction)
    const reopenResult = transitionChequeStatus(clearResult.cheque, 'open', {
        transitionDate: '2026-10-13T09:00:00Z',
    });
    assert(reopenResult.success === true, 'Successfully reopened cleared cheque');
    assert(reopenResult.cheque.status === 'open', 'Status reverted to "open"');
    assert(reopenResult.ledgerEffect.bankBalanceDelta === -85000, 'Bank account debited by -₹85,000 to reverse mistake');
}

// -------------------------------------------------------------------------
// TEST 5: Issued Cheque Lifecycle (Company Pays Vendor)
// -------------------------------------------------------------------------
console.log('\nSuite 5: Issued Cheque Lifecycle');
{
    const issuedCheque: ChequeRecord = {
        id: 'chq-002',
        chequeNumber: '000889',
        direction: 'issued',
        partyName: 'Manappuram Bullion Supplier',
        bankName: 'ICICI Bank',
        chequeDate: '2026-10-12',
        amount: 250000,
        status: 'deposited',
        targetBankAccountId: 'bank-icici',
        targetBankAccountName: 'ICICI Current A/C',
        createdDate: '2026-10-12T10:00:00Z',
        modifiedDate: '2026-10-12T10:00:00Z',
    };

    const clearIssued = transitionChequeStatus(issuedCheque, 'cleared');
    assert(clearIssued.success === true, 'Issued cheque cleared');
    assert(clearIssued.ledgerEffect.bankBalanceDelta === -250000, 'Company bank debited by -₹250,000');
}

// -------------------------------------------------------------------------
// TEST 6: Bounced Cheque Handling & Penalty Charges
// -------------------------------------------------------------------------
console.log('\nSuite 6: Bounced Cheque & Dishonor Penalty');
{
    const cheque: ChequeRecord = {
        id: 'chq-003',
        chequeNumber: '000777',
        direction: 'received',
        partyName: 'Anil Verma',
        bankName: 'Punjab National Bank',
        chequeDate: '2026-10-05',
        amount: 42000,
        status: 'deposited',
        targetBankAccountId: 'bank-acc-sbi',
        createdDate: '2026-10-05T10:00:00Z',
        modifiedDate: '2026-10-06T10:00:00Z',
    };

    const bounceResult = transitionChequeStatus(cheque, 'bounced', {
        bounceReason: 'Funds Insufficient',
        bouncePenaltyCharge: 350, // ₹350 bank bounce penalty
    });

    assert(bounceResult.success === true, 'Marked as bounced');
    assert(bounceResult.cheque.status === 'bounced', 'Cheque status is "bounced"');
    assert(bounceResult.cheque.bouncePenaltyCharge === 350, 'Bounce penalty of ₹350 recorded on cheque');
    assert(bounceResult.ledgerEffect.bankBalanceDelta === -350, 'Bank charged ₹350 bounce penalty fee');
    assert(bounceResult.ledgerEffect.partyReceivableDelta === (42000 + 350), 'Customer balance reinstated with cheque amount + ₹350 penalty (₹42,350)');
}

// -------------------------------------------------------------------------
// TEST 7: Cheque Portfolio KPI Aggregations
// -------------------------------------------------------------------------
console.log('\nSuite 7: Portfolio KPI Aggregations');
{
    const portfolio: ChequeRecord[] = [
        // 1. Open in-hand current
        { id: '1', chequeNumber: '000101', direction: 'received', partyName: 'P1', bankName: 'B1', chequeDate: '2026-10-13', amount: 10000, status: 'open', createdDate: '', modifiedDate: '' },
        // 2. Open PDC (future)
        { id: '2', chequeNumber: '000102', direction: 'received', partyName: 'P2', bankName: 'B2', chequeDate: '2026-10-25', amount: 25000, status: 'open', createdDate: '', modifiedDate: '' },
        // 3. Open Stale (>90 days past)
        { id: '3', chequeNumber: '000103', direction: 'received', partyName: 'P3', bankName: 'B3', chequeDate: '2026-06-01', amount: 15000, status: 'open', createdDate: '', modifiedDate: '' },
        // 4. Deposited in clearing
        { id: '4', chequeNumber: '000104', direction: 'received', partyName: 'P4', bankName: 'B4', chequeDate: '2026-10-12', amount: 50000, status: 'deposited', createdDate: '', modifiedDate: '' },
        // 5. Cleared
        { id: '5', chequeNumber: '000105', direction: 'received', partyName: 'P5', bankName: 'B5', chequeDate: '2026-10-10', amount: 120000, status: 'cleared', createdDate: '', modifiedDate: '' },
        // 6. Bounced
        { id: '6', chequeNumber: '000106', direction: 'received', partyName: 'P6', bankName: 'B6', chequeDate: '2026-10-08', amount: 30000, status: 'bounced', createdDate: '', modifiedDate: '' },
    ];

    const summary = aggregateChequePortfolio(portfolio, '2026-10-13');

    assert(summary.totalCount === 6, 'Total cheque count: 6');
    assert(summary.totalAmount === 250000, 'Total portfolio amount: ₹250,000', `Got ${summary.totalAmount}`);
    assert(summary.openInHandCount === 3, 'Open in-hand count: 3');
    assert(summary.openInHandAmount === 50000, 'Open in-hand amount: ₹50,000');
    assert(summary.pdcCount === 1, 'PDC count: 1');
    assert(summary.pdcAmount === 25000, 'PDC amount: ₹25,000');
    assert(summary.staleCount === 1, 'Stale count: 1');
    assert(summary.staleAmount === 15000, 'Stale amount: ₹15,000');
    assert(summary.depositedPendingCount === 1, 'Deposited pending count: 1');
    assert(summary.depositedPendingAmount === 50000, 'Deposited pending amount: ₹50,000');
    assert(summary.clearedCount === 1, 'Cleared count: 1');
    assert(summary.clearedAmount === 120000, 'Cleared amount: ₹120,000');
    assert(summary.bouncedCount === 1, 'Bounced count: 1');
    assert(summary.bouncedAmount === 30000, 'Bounced amount: ₹30,000');
}

console.log('\n============================================================');
console.log(`PHASE 3 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
if (passedTests === totalTests) {
    console.log('STATUS: BRUTAL VERIFICATION PHASE 3 SUCCESSFUL! 🚀');
} else {
    console.error('STATUS: VERIFICATION FAILED! ❌');
    process.exit(1);
}
console.log('============================================================\n');
