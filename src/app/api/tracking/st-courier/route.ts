import { NextRequest, NextResponse } from "next/server";
import { fetchStCourierLiveTracking, isValidStCourierAwb } from "@/lib/logistics-engine";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const rawAwb = searchParams.get("awb") || "";
    const format = searchParams.get("format");
    const isJson = format === "json" || request.headers.get("accept")?.includes("application/json");

    const cleanAwb = rawAwb.replace(/[^0-9]/g, "");

    if (!cleanAwb || !isValidStCourierAwb(cleanAwb)) {
        if (isJson) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid AWB number. ST Courier tracking numbers must be exactly 11 numeric digits.",
                    providedAwb: rawAwb,
                },
                { status: 400 }
            );
        }

        return new NextResponse(
            renderHtmlShell(`
                <div class="card error-card">
                    <div class="icon-circle error-circle">⚠️</div>
                    <h2>Invalid ST Courier AWB</h2>
                    <p>The tracking number <code>${escapeHtml(rawAwb || "empty")}</code> is invalid. ST Courier tracking numbers are exactly 11 digits.</p>
                    <form action="/api/tracking/st-courier" method="GET" class="search-form">
                        <input type="text" name="awb" placeholder="Enter 11-digit AWB (e.g. 64437374632)" maxlength="11" pattern="\\d{11}" required />
                        <button type="submit">Track Shipment</button>
                    </form>
                </div>
            `),
            {
                status: 400,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            }
        );
    }

    // Fetch live reverse-engineered tracking details
    const tracking = await fetchStCourierLiveTracking(cleanAwb);

    if (isJson) {
        return NextResponse.json({
            success: tracking.isValid,
            tracking,
        });
    }

    // Render luxurious Luminila mobile tracking page
    const status = tracking.summary?.currentStatus || tracking.statusText || "In Transit";
    const isDelivered = status.toLowerCase().includes("delivered");
    const isOutForDelivery = status.toLowerCase().includes("out for delivery");
    
    let statusClass = "status-transit";
    let statusIcon = "🚚";
    if (isDelivered) {
        statusClass = "status-delivered";
        statusIcon = "✅";
    } else if (isOutForDelivery) {
        statusClass = "status-out";
        statusIcon = "🛵";
    }

    const summary = tracking.summary || {};
    const events = tracking.events || [];

    const timelineHtml = events.length > 0 ? events.map((ev, idx) => `
        <div class="timeline-item ${idx === 0 ? "active" : ""}">
            <div class="timeline-marker"></div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <span class="timeline-status">${escapeHtml(ev.status)}</span>
                    <span class="timeline-time">${escapeHtml(ev.dateTime)}</span>
                </div>
                ${ev.location ? `<div class="timeline-location">📍 ${escapeHtml(ev.location)}</div>` : ""}
            </div>
        </div>
    `).join("") : `
        <div class="empty-timeline">
            <p>Shipment data registered. Carrier network updating in real-time.</p>
        </div>
    `;

    const htmlContent = `
        <div class="container">
            <!-- Brand Crest -->
            <div class="brand-header">
                <div class="brand-crest">✨ LUMINILA JEWELS</div>
                <div class="brand-sub">Express Insured Transit • ST Courier Integration</div>
            </div>

            <!-- Status Card -->
            <div class="card main-card">
                <div class="card-top">
                    <div class="carrier-badge">
                        <span class="carrier-dot"></span>
                        ST Courier Express
                    </div>
                    <div class="awb-badge" onclick="navigator.clipboard.writeText('${cleanAwb}'); alert('AWB copied to clipboard!');">
                        AWB: <strong>${cleanAwb}</strong> 📋
                    </div>
                </div>

                <div class="status-banner ${statusClass}">
                    <span class="status-icon">${statusIcon}</span>
                    <div class="status-info">
                        <div class="status-label">Current Status</div>
                        <div class="status-title">${escapeHtml(status)}</div>
                    </div>
                </div>

                <!-- Consignment Summary Details -->
                <div class="details-grid">
                    <div class="detail-box">
                        <div class="detail-label">Origin Hub</div>
                        <div class="detail-val">${escapeHtml(summary.origin || "Origin Transit")}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Destination</div>
                        <div class="detail-val">${escapeHtml(summary.destination || "Destination Hub")}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Booking Date</div>
                        <div class="detail-val">${escapeHtml(summary.bookDateTime || "Recorded")}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">${isDelivered ? "Delivered On" : "Expected Delivery"}</div>
                        <div class="detail-val highlight">${escapeHtml(summary.deliveryDateTime || "In Scheduled Transit")}</div>
                    </div>
                </div>
            </div>

            <!-- Tracking Timeline -->
            <div class="card timeline-card">
                <h3 class="section-title">📦 Shipment Journey & Milestones</h3>
                <div class="timeline">
                    ${timelineHtml}
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="actions-card">
                <a href="https://stcourier.com" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                    ST Courier Official Portal ↗
                </a>
                <a href="https://wa.me/?text=${encodeURIComponent(`Hi Luminila Team, regarding my ST Courier shipment #${cleanAwb}`)}" target="_blank" rel="noopener noreferrer" class="btn btn-gold">
                    💬 WhatsApp Concierge Support
                </a>
            </div>

            <div class="footer">
                <p>Insured Precious Transit • Tamper-Evident Security Seal Protocol</p>
                <p class="copyright">© ${new Date().getFullYear()} Luminila Luxury Jewels. All rights reserved.</p>
            </div>
        </div>
    `;

    return new NextResponse(renderHtmlShell(htmlContent, cleanAwb), {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
    });
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderHtmlShell(bodyContent: string, awbNumber?: string): string {
    const title = awbNumber ? `Tracking #${awbNumber} • ST Courier • Luminila Jewels` : `Track ST Courier Shipment • Luminila Jewels`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #0a0e17;
            --surface: #111827;
            --surface-card: #162032;
            --surface-hover: #1f2d45;
            --gold: #d4af37;
            --gold-light: #f3e5ab;
            --gold-gradient: linear-gradient(135deg, #d4af37 0%, #aa8010 100%);
            --emerald: #10b981;
            --amber: #f59e0b;
            --blue: #3b82f6;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border: rgba(255, 255, 255, 0.08);
            --border-gold: rgba(212, 175, 55, 0.3);
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.5;
            padding: 24px 16px;
            min-height: 100vh;
            display: flex;
            justify-content: center;
        }
        .container {
            width: 100%;
            max-width: 580px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .brand-header {
            text-align: center;
            padding: 12px 0 6px 0;
        }
        .brand-crest {
            font-family: 'Cinzel', serif;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 2px;
            background: linear-gradient(135deg, #fce09b 0%, #d4af37 50%, #aa8010 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-transform: uppercase;
        }
        .brand-sub {
            font-size: 11px;
            color: var(--text-muted);
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-top: 4px;
        }
        .card {
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
        }
        .main-card {
            border: 1px solid var(--border-gold);
            background: linear-gradient(180deg, rgba(22, 32, 50, 0.95) 0%, rgba(17, 24, 39, 0.95) 100%);
        }
        .card-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        .carrier-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background: rgba(212, 175, 55, 0.12);
            color: var(--gold-light);
            padding: 5px 10px;
            border-radius: 20px;
            border: 1px solid rgba(212, 175, 55, 0.25);
        }
        .carrier-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--gold);
            box-shadow: 0 0 8px var(--gold);
        }
        .awb-badge {
            font-family: monospace;
            font-size: 12px;
            color: var(--text-muted);
            background: rgba(255, 255, 255, 0.05);
            padding: 5px 10px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .awb-badge strong {
            color: var(--text-main);
        }
        .awb-badge:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .status-banner {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 16px;
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .status-delivered {
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.3);
            color: #34d399;
        }
        .status-out {
            background: rgba(245, 158, 11, 0.12);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: #fbbf24;
        }
        .status-transit {
            background: rgba(59, 130, 246, 0.12);
            border: 1px solid rgba(59, 130, 246, 0.3);
            color: #60a5fa;
        }
        .status-icon {
            font-size: 28px;
        }
        .status-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.8;
            font-weight: 500;
        }
        .status-title {
            font-size: 20px;
            font-weight: 700;
            color: #ffffff;
        }
        .details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .detail-box {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 12px;
            border-radius: 10px;
        }
        .detail-label {
            font-size: 10px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 3px;
        }
        .detail-val {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-main);
        }
        .detail-val.highlight {
            color: var(--gold-light);
        }
        .section-title {
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 16px;
            color: var(--text-main);
            letter-spacing: 0.3px;
        }
        .timeline {
            position: relative;
            padding-left: 20px;
        }
        .timeline::before {
            content: '';
            position: absolute;
            top: 6px;
            bottom: 6px;
            left: 7px;
            width: 2px;
            background: rgba(255, 255, 255, 0.1);
        }
        .timeline-item {
            position: relative;
            margin-bottom: 20px;
        }
        .timeline-item:last-child {
            margin-bottom: 0;
        }
        .timeline-marker {
            position: absolute;
            left: -20px;
            top: 4px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #25334a;
            border: 2px solid #4a5c7c;
        }
        .timeline-item.active .timeline-marker {
            background: var(--gold);
            border-color: #f3e5ab;
            box-shadow: 0 0 10px rgba(212, 175, 55, 0.7);
        }
        .timeline-content {
            padding-left: 6px;
        }
        .timeline-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 3px;
        }
        .timeline-status {
            font-size: 13px;
            font-weight: 600;
            color: #ffffff;
        }
        .timeline-item.active .timeline-status {
            color: var(--gold-light);
        }
        .timeline-time {
            font-size: 11px;
            color: var(--text-muted);
            white-space: nowrap;
        }
        .timeline-location {
            font-size: 12px;
            color: var(--text-muted);
        }
        .actions-card {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 12px 16px;
            border-radius: 10px;
            text-decoration: none;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
            cursor: pointer;
            border: none;
        }
        .btn-gold {
            background: var(--gold-gradient);
            color: #0b0f17;
            font-weight: 700;
        }
        .btn-gold:hover {
            opacity: 0.95;
            transform: translateY(-1px);
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.06);
            color: var(--text-main);
            border: 1px solid var(--border);
        }
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .footer {
            text-align: center;
            font-size: 11px;
            color: var(--text-muted);
            padding: 16px 0;
            line-height: 1.6;
        }
        .copyright {
            opacity: 0.6;
            margin-top: 4px;
        }
        .error-card {
            text-align: center;
            padding: 40px 24px;
        }
        .icon-circle {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            margin: 0 auto 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        .error-circle {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .search-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 20px;
        }
        .search-form input {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--border);
            padding: 12px 16px;
            border-radius: 8px;
            color: white;
            font-size: 14px;
            text-align: center;
            letter-spacing: 2px;
        }
        .search-form button {
            background: var(--gold-gradient);
            color: #000;
            border: none;
            padding: 12px;
            border-radius: 8px;
            font-weight: 700;
            cursor: pointer;
        }
    </style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
}
