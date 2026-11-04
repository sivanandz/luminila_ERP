/**
 * RETIRED (SCR-8 / SCR-1).
 *
 * This script used to write a real store's settings into `store_settings`:
 * GSTIN, PAN, bank account number, IFSC and the full registered address were
 * committed to version control as literals. The body was already disabled (an
 * early `return` under a "Deprecated" warning), so it wrote nothing while the
 * PII stayed readable in the repository and was one deleted line away from
 * running again.
 *
 * The dead dataset has been deleted rather than parameterised: seeding live
 * financial identity from a checked-in script is the vulnerability, and every
 * remaining datum (store name, address, GSTIN, PAN, bank details, invoice
 * terms) is tenant-specific.
 *
 * How to seed a store now:
 *   1. Enter the values in Settings (store profile, tax ids, bank details) or
 *      import them through the app's own admin UI.
 *   2. If a scripted path is genuinely needed, write it to read every value
 *      from the environment (STORE_GSTIN, STORE_PAN, STORE_BANK_ACCOUNT, …)
 *      with PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD for the connection —
 *      never literals, and never a default admin identity.
 *
 * Remaining owner action for SCR-1: the literals are still in git history.
 * Purging history and rotating the GSTIN/PAN/bank credentials (if they were
 * real) is a user decision — this script cannot and does not claim it happened.
 */

console.warn(
    'seed-real-store-settings.js is retired: the checked-in store PII has been removed. ' +
    'Configure the store in Settings instead. See the header of this file for the env-driven pattern.'
);
process.exit(0);
