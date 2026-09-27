const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARTIFACT_DIR = 'C:\\Users\\sivan\\.gemini\\antigravity-ide\\brain\\1e64ba8f-d4d3-432b-9ef2-957c597bf260';
const ADB = 'C:\\Users\\sivan\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';

async function getWsUrl() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9223/json/list', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const list = JSON.parse(data);
                if (list.length > 0 && list[0].webSocketDebuggerUrl) {
                    resolve(list[0].webSocketDebuggerUrl);
                } else {
                    reject(new Error('No inspectable page found'));
                }
            });
        }).on('error', reject);
    });
}

async function evalInWebview(expr, awaitPromise = false) {
    const wsUrl = await getWsUrl();
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const reqId = Math.floor(Math.random() * 100000);
        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: reqId,
                method: 'Runtime.evaluate',
                params: {
                    expression: expr,
                    awaitPromise: awaitPromise,
                    returnByValue: true
                }
            }));
        };
        ws.onmessage = (evt) => {
            const data = JSON.parse(evt.data);
            if (data.id === reqId) {
                ws.close();
                if (data.result.exceptionDetails) {
                    reject(data.result.exceptionDetails);
                } else {
                    resolve(data.result.result.value);
                }
            }
        };
        ws.onerror = reject;
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function captureScreen(filename) {
    try {
        const dest = path.join(ARTIFACT_DIR, filename);
        execSync(`& "${ADB}" -s emulator-5554 shell screencap -p /sdcard/${filename}`, { shell: 'powershell' });
        execSync(`& "${ADB}" -s emulator-5554 pull /sdcard/${filename} "${dest}"`, { shell: 'powershell' });
        return true;
    } catch (e) {
        console.error(`Failed to capture ${filename}:`, e.message);
        return false;
    }
}

async function testPage(name, route, customCheck) {
    console.log(`\n========================================`);
    console.log(`[TEST] ${name} -> Route: ${route}`);
    console.log(`========================================`);

    // Navigate to route via bottom nav or mobile drawer
    await evalInWebview(`
        (async () => {
            if (window.location.pathname === '${route}') return;

            // 1. Direct link on screen (bottom nav, etc.)
            let link = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === '${route}');
            if (link) {
                link.click();
                return;
            }

            // 2. Open mobile drawer via Menu button
            const menuBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Menu') || b.getAttribute('aria-label') === 'Menu');
            if (menuBtn) {
                menuBtn.click();
                await new Promise(r => setTimeout(r, 500));
                link = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === '${route}');
                if (link) {
                    link.click();
                    return;
                }
            }

            // 3. Fallback: window.location.href
            window.location.href = '${route}';
        })()
    `, true);

    await sleep(2500);

    const state = await evalInWebview(`
        (() => {
            const hasBoundary = document.body.innerText.includes('Something went wrong');
            const errorBanner = document.querySelector('[role="alert"], .text-destructive');
            const isError = hasBoundary || (errorBanner && (
                errorBanner.innerText.includes('Cannot read') ||
                errorBanner.innerText.includes('Access Denied')
            ));
            return {
                pathname: window.location.pathname,
                title: document.title,
                heading: document.querySelector('h1, h2')?.innerText,
                isError: !!isError,
                errorMessage: isError ? errorBanner.innerText : null,
                buttonsCount: document.querySelectorAll('button').length,
                inputsCount: document.querySelectorAll('input').length,
                bodyPreview: document.body.innerText.slice(0, 180).replace(/\\n+/g, ' ')
            };
        })()
    `);

    let detail = null;
    if (customCheck) {
        detail = await customCheck();
    }

    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const screenshot = `verify_${safeName}.png`;
    captureScreen(screenshot);

    console.log('Result:', {
        name,
        pathname: state.pathname,
        heading: state.heading,
        isError: state.isError,
        detail,
        screenshot
    });

    return {
        name,
        route,
        state,
        detail,
        screenshot,
        passed: !state.isError && state.pathname === route
    };
}

async function main() {
    const results = [];

    // Ensure session is authenticated
    const auth = await evalInWebview(`
        (() => {
            const pb = localStorage.getItem('pocketbase_auth');
            return pb ? JSON.parse(pb).isValid : false;
        })()
    `);
    console.log('Initial Auth Valid:', auth);

    // 1. Dashboard
    results.push(await testPage('Dashboard', '/', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasRevenue: document.body.innerText.includes('Monthly Revenue'),
                    hasOrders: document.body.innerText.includes('Total Orders'),
                    hasTrendChart: !!document.querySelector('svg, .recharts-responsive-container')
                };
            })()
        `);
    }));

    // 2. Point of Sale (POS)
    results.push(await testPage('POS', '/pos', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasSearch: !!document.querySelector('input'),
                    hasCartOrTotal: document.body.innerText.includes('Total') || document.body.innerText.includes('₹'),
                    hasPaymentMethods: document.body.innerText.includes('Cash') || document.body.innerText.includes('UPI') || document.body.innerText.includes('Card')
                };
            })()
        `);
    }));

    // 3. Stock / Inventory
    results.push(await testPage('Inventory', '/inventory', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasSearch: !!document.querySelector('input'),
                    hasProductsCount: document.body.innerText.includes('Items') || document.body.innerText.includes('Products') || document.body.innerText.includes('Stock'),
                    actionButtons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean).slice(0, 5)
                };
            })()
        `);
    }));

    // 4. Invoices
    results.push(await testPage('Invoices', '/invoices', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasInvoiceHeader: document.body.innerText.includes('Invoices'),
                    hasTableOrEmpty: document.body.innerText.includes('No invoices found') || document.querySelectorAll('table tr').length > 0
                };
            })()
        `);
    }));

    // 5. Orders & Estimates
    results.push(await testPage('Orders', '/orders', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasOrdersTitle: document.body.innerText.includes('Orders'),
                    hasFilterTabs: document.body.innerText.includes('All') || document.body.innerText.includes('Pending')
                };
            })()
        `);
    }));

    // 6. Delivery Challan
    results.push(await testPage('Delivery Challan', '/challan', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasChallanTitle: document.body.innerText.includes('Challan') || document.body.innerText.includes('Delivery'),
                    hasNewBtn: Array.from(document.querySelectorAll('button, a')).some(b => b.innerText.includes('New') || b.innerText.includes('Create'))
                };
            })()
        `);
    }));

    // 7. Returns & Credit Notes
    results.push(await testPage('Returns', '/returns', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasReturnsTitle: document.body.innerText.includes('Return') || document.body.innerText.includes('Credit Note'),
                    hasNewBtn: Array.from(document.querySelectorAll('button, a')).some(b => b.innerText.includes('New') || b.innerText.includes('Create'))
                };
            })()
        `);
    }));

    // 8. Purchase Orders
    results.push(await testPage('Purchases', '/purchase', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasPurchaseTitle: document.body.innerText.includes('Purchase'),
                    hasTable: document.querySelectorAll('table, [role="table"]').length > 0
                };
            })()
        `);
    }));

    // 9. Vendors
    results.push(await testPage('Vendors', '/vendors', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasVendorsTitle: document.body.innerText.includes('Vendor'),
                    hasAddBtn: Array.from(document.querySelectorAll('button, a')).some(b => b.innerText.includes('Vendor') || b.innerText.includes('Add'))
                };
            })()
        `);
    }));

    // 10. Customers CRM (The one previously affected by typeConfig bug)
    results.push(await testPage('Customers', '/customers', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasCustomersTitle: document.body.innerText.includes('Customer'),
                    customerCards: document.querySelectorAll('.grid > div, [role="article"]').length,
                    hasAddBtn: Array.from(document.querySelectorAll('button, a')).some(b => b.innerText.includes('Customer') || b.innerText.includes('Add'))
                };
            })()
        `);
    }));

    // 11. Barcode Labels
    results.push(await testPage('Labels', '/labels', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasLabelsTitle: document.body.innerText.includes('Label') || document.body.innerText.includes('Barcode'),
                    hasBarcodeControls: !!document.querySelector('select, input')
                };
            })()
        `);
    }));

    // 12. Banking & Ledger
    results.push(await testPage('Banking', '/banking', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasBankingTitle: document.body.innerText.includes('Bank') || document.body.innerText.includes('Ledger'),
                    hasSummary: document.body.innerText.includes('Balance') || document.body.innerText.includes('₹')
                };
            })()
        `);
    }));

    // 13. Expenses
    results.push(await testPage('Expenses', '/expenses', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasExpensesTitle: document.body.innerText.includes('Expense'),
                    hasAddBtn: Array.from(document.querySelectorAll('button, a')).some(b => b.innerText.includes('Expense') || b.innerText.includes('Add'))
                };
            })()
        `);
    }));

    // 14. Reports & Analytics
    results.push(await testPage('Reports', '/reports', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasReportsTitle: document.body.innerText.includes('Report'),
                    reportCards: document.querySelectorAll('.grid > div, a[href*="report"]').length
                };
            })()
        `);
    }));

    // 15. Settings
    results.push(await testPage('Settings', '/settings', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasSettingsTitle: document.body.innerText.includes('Settings'),
                    hasSaveBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Save'))
                };
            })()
        `);
    }));

    // 16. WhatsApp Integration
    results.push(await testPage('WhatsApp', '/whatsapp', async () => {
        return await evalInWebview(`
            (() => {
                return {
                    hasWhatsAppTitle: document.body.innerText.includes('WhatsApp'),
                    hasStatusIndicator: document.body.innerText.includes('Status') || document.body.innerText.includes('QR') || document.body.innerText.includes('Disconnect') || document.body.innerText.includes('Connect')
                };
            })()
        `);
    }));

    // 17. Mobile Drawer & Server Configuration Modal
    console.log(`\n========================================`);
    console.log(`[TEST] Mobile Drawer & Server Config Modal`);
    console.log(`========================================`);
    await evalInWebview(`window.location.href = '/';`);
    await sleep(2500);

    const openDrawer = await evalInWebview(`
        (() => {
            const menuBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Menu'));
            if (menuBtn) {
                menuBtn.click();
                return true;
            }
            return false;
        })()
    `);
    await sleep(1500);
    captureScreen('verify_mobile_drawer.png');

    // Click Server Config in Drawer
    const openServerModal = await evalInWebview(`
        (() => {
            const serverBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Server Config') || b.innerText.includes('Server'));
            if (serverBtn) {
                serverBtn.click();
                return true;
            }
            return false;
        })()
    `);
    await sleep(2000);
    captureScreen('verify_server_config_modal.png');

    const serverModalState = await evalInWebview(`
        (() => {
            const modalTitle = document.querySelector('[role="dialog"] h2')?.innerText;
            const pbInput = document.querySelector('[role="dialog"] input[type="text"]')?.value;
            const statusBadge = document.querySelector('[role="dialog"] .badge, [role="dialog"] [class*="badge"]')?.innerText;
            return { modalTitle, pbInput, statusBadge, dialogOpen: !!document.querySelector('[role="dialog"]') };
        })()
    `);

    results.push({
        name: 'Server Configuration Modal',
        route: '/',
        state: { pathname: '/', isError: false },
        detail: serverModalState,
        screenshot: 'verify_server_config_modal.png',
        passed: !!serverModalState.dialogOpen
    });

    console.log('\n========================================');
    console.log('FINAL VERIFICATION SUMMARY');
    console.log('========================================');
    console.table(results.map(r => ({
        Feature: r.name,
        Route: r.route,
        Passed: r.passed ? 'PASS' : 'FAIL',
        Screenshot: r.screenshot
    })));

    fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'final_verification_results.json'),
        JSON.stringify(results, null, 2)
    );
}

main().catch(console.error);
