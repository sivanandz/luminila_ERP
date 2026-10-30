/**
 * Deployment mode for this build.
 *
 * One deployment serves exactly one account: Niththigal. In single mode every
 * PocketBase resolution path returns the primary database and every record is
 * stamped and filtered with SINGLE_ACCOUNT_EMAIL, whichever user signed in.
 * Multi-account (one PocketBase database per login email, plus per-email
 * tenant scoping) is an opt-in that can be re-enabled later.
 *
 * This module has no imports and touches neither Node nor browser APIs: client
 * components, client hooks and server routes all import it and must resolve
 * the same constants.
 */

export type DeploymentMode = 'single' | 'multi';

/** Address of the one account that owns every record in single mode. */
const DEFAULT_SINGLE_ACCOUNT_EMAIL = 'niththigal@gmail.com';

/** Internal helper: trim a raw value and treat whitespace-only as absent. */
function readEnv(value: string | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Which account model this deployment runs.
 *
 * Multi is enabled only when TENANT_MODE or NEXT_PUBLIC_TENANT_MODE trims down
 * to "multi" (case-insensitive). Everything else — unset, empty or
 * whitespace-only — means single, which is the default.
 *
 * Constraint: NEXT_PUBLIC_TENANT_MODE is inlined into the client bundle at
 * build time, so re-enabling multi requires BOTH env vars to be set AND a
 * rebuild. Setting only the server-side TENANT_MODE at runtime leaves the
 * browser bundle in single mode.
 */
export function getDeploymentMode(): DeploymentMode {
    const publicMode = readEnv(process.env.NEXT_PUBLIC_TENANT_MODE)?.toLowerCase();
    const serverMode = readEnv(process.env.TENANT_MODE)?.toLowerCase();
    return publicMode === 'multi' || serverMode === 'multi' ? 'multi' : 'single';
}

/** True when this deployment runs the single-account model (the default). */
export function isSingleAccountMode(): boolean {
    return getDeploymentMode() === 'single';
}

/** True when multi-account tenant scoping is re-enabled. */
export function isMultiAccountEnabled(): boolean {
    return getDeploymentMode() === 'multi';
}

/**
 * The one account every record belongs to in single mode.
 *
 * Precedence: NEXT_PUBLIC_ACCOUNT_EMAIL, then ACCOUNT_EMAIL, then the Niththigal
 * account. Trimmed and lowercased; never empty.
 *
 * Constraint: PocketBase compares a record's account_email against the signed-in
 * user's email, so the login used in production MUST be this address. Override
 * both env vars together when the deployment logs in as a different account.
 */
export const SINGLE_ACCOUNT_EMAIL: string = (
    readEnv(process.env.NEXT_PUBLIC_ACCOUNT_EMAIL) ??
    readEnv(process.env.ACCOUNT_EMAIL) ??
    DEFAULT_SINGLE_ACCOUNT_EMAIL
).toLowerCase();

/** Store name owned by the single account. */
export const SINGLE_ACCOUNT_STORE_NAME: string = 'Niththigal';
