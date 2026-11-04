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

function toMode(value: string | undefined): DeploymentMode | undefined {
    const raw = readEnv(value)?.toLowerCase();
    if (!raw) return undefined;
    return raw === 'multi' ? 'multi' : 'single';
}

let mismatchLogged = false;

interface ModeMismatch {
    publicMode: DeploymentMode;
    serverMode: DeploymentMode;
}

function modeMismatch(): ModeMismatch | null {
    const publicMode = toMode(process.env.NEXT_PUBLIC_TENANT_MODE);
    const serverMode = toMode(process.env.TENANT_MODE);
    if (!publicMode || !serverMode || publicMode === serverMode) return null;
    return { publicMode, serverMode };
}

/**
 * Which account model this deployment runs.
 *
 * Single source of truth: `TENANT_MODE` (server) and `NEXT_PUBLIC_TENANT_MODE`
 * (browser) must agree. When both are set and disagree, the mismatch is logged
 * loudly and the trusted value for the current context wins — the server value
 * on the server, the public value in the browser. Server-side auth entry points
 * call `assertDeploymentModeConsistent()` and refuse to run a split deployment
 * (INF-12).
 *
 * Constraint: NEXT_PUBLIC_TENANT_MODE is inlined into the client bundle at
 * build time, so re-enabling multi requires BOTH env vars to be set AND a
 * rebuild. Setting only the server-side TENANT_MODE at runtime leaves the
 * browser bundle in single mode.
 */
export function getDeploymentMode(): DeploymentMode {
    const mismatch = modeMismatch();
    if (mismatch) {
        const isServer = typeof window === 'undefined';
        if (!mismatchLogged) {
            mismatchLogged = true;
            console.error(
                `[deployment-mode] NEXT_PUBLIC_TENANT_MODE="${mismatch.publicMode}" disagrees with ` +
                `TENANT_MODE="${mismatch.serverMode}". Using the ${isServer ? 'server' : 'browser'} value; ` +
                'set both to the same mode and rebuild.'
            );
        }
        return isServer ? mismatch.serverMode : mismatch.publicMode;
    }
    return toMode(process.env.NEXT_PUBLIC_TENANT_MODE)
        ?? toMode(process.env.TENANT_MODE)
        ?? 'single';
}

/**
 * Refuse to serve a split single/multi deployment on the server.
 *
 * The browser bundle cannot see `TENANT_MODE`, so a disagreement means the
 * server and the shipped client would scope records differently. Called from
 * the server auth entry points, which fail closed instead of silently splitting.
 */
export function assertDeploymentModeConsistent(): void {
    const mismatch = modeMismatch();
    if (!mismatch || typeof window !== 'undefined') return;
    throw new Error(
        `Deployment mode mismatch: NEXT_PUBLIC_TENANT_MODE="${mismatch.publicMode}" ` +
        `but TENANT_MODE="${mismatch.serverMode}". Refusing to serve a split single/multi deployment.`
    );
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
