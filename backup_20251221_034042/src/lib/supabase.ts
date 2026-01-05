import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/types/database";

// Environment variables will be set in .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * Supabase Client - Single Source of Truth
 * 
 * This abstraction layer makes future migration easy:
 * - Today: Supabase Cloud (serverless)
 * - Future: Self-hosted Supabase on Oracle Cloud Free Tier
 * - Future: Direct PostgreSQL connection
 */

// Create singleton Supabase client
let supabaseClient: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
    if (!supabaseClient) {
        if (!supabaseUrl || !supabaseAnonKey) {
            console.warn("Supabase credentials not configured. Running in offline mode.");
            // Return a mock client for development without Supabase
            return createClient<Database>(
                "https://placeholder.supabase.co",
                "placeholder-key"
            );
        }
        supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
            },
            realtime: {
                params: {
                    eventsPerSecond: 10,
                },
            },
        });
    }
    return supabaseClient;
}

// Export singleton for convenience
export const supabase = getSupabase();

/**
 * Subscribe to realtime changes on a table
 */
export function subscribeToTable<T extends keyof Database["public"]["Tables"]>(
    table: T,
    callback: (payload: {
        eventType: "INSERT" | "UPDATE" | "DELETE";
        new: Database["public"]["Tables"][T]["Row"];
        old: Database["public"]["Tables"][T]["Row"];
    }) => void
) {
    return supabase
        .channel(`${table}_changes`)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: table,
            },
            (payload) => {
                callback({
                    eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
                    new: payload.new as Database["public"]["Tables"][T]["Row"],
                    old: payload.old as Database["public"]["Tables"][T]["Row"],
                });
            }
        )
        .subscribe();
}

/**
 * Check if Supabase is connected
 */
export async function checkConnection(): Promise<boolean> {
    try {
        const { error } = await supabase.from("products").select("id").limit(1);
        return !error;
    } catch {
        return false;
    }
}
