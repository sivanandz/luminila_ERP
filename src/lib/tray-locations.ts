/**
 * Editable tray/storage locations for product editors, the cycle-count
 * station and the label clerk code.
 *
 * The managed list lives in the inventory_locations registry (Settings →
 * Tray Locations). product.location stores the location CODE (e.g. "A2"),
 * which is exactly what the rat-tail label prints after the 2× base price.
 * When nothing has been configured yet, the legacy preset names act as the
 * codes so existing installs keep working unchanged.
 */

import { STORAGE_LOCATIONS } from "./products";
import { getManagedLocations } from "./multi-location";

export interface TrayLocationOption {
    code: string;
    name: string;
}

/** Active managed locations, or the legacy presets when the registry is empty. */
export async function loadTrayLocationOptions(): Promise<TrayLocationOption[]> {
    try {
        const managed = await getManagedLocations();
        if (managed.length > 0) {
            return managed.map((l) => ({ code: l.code, name: l.name }));
        }
    } catch (err) {
        console.warn("Managed tray locations unavailable; using presets:", err);
    }
    return STORAGE_LOCATIONS.map((name) => ({ code: name, name }));
}

/** Select choices for an editor: managed options (or preset fallback), with
 *  the product's current value kept selectable even if it is legacy or a
 *  deactivated code so no edit silently rewrites it. */
export function trayChoices(options: TrayLocationOption[], current?: string): TrayLocationOption[] {
    const base = options.length > 0 ? options : STORAGE_LOCATIONS.map((name) => ({ code: name, name }));
    const cur = (current || "").trim();
    if (cur && !base.some((o) => o.code === cur)) {
        return [...base, { code: cur, name: cur }];
    }
    return base;
}

/** "A2" when code and name match, otherwise "A2 · Showcase Tray 2". */
export function trayChoiceLabel(option: TrayLocationOption): string {
    return option.code === option.name ? option.code : `${option.code} · ${option.name}`;
}
