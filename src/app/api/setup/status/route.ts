import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Setup bootstrap status: Setup is sealed for security.
 */
export async function GET() {
    return NextResponse.json({ complete: true });
}
