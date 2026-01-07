const wppconnect = require('@wppconnect-team/wppconnect');

(async () => {
    console.log('Starting Pairing Code Test...');
    try {
        // We need to capture the client somehow. 
        // NOTE: standard create() waits for login.
        // We hope that 'catchQR' or 'statusFind' might allow us to interact?
        // OR we use the trick of `headless: true` and see if we can get the client.

        // Actually, we can define a variable `clientRef` and assign it if exposed? 
        // Unlikely wppconnect passes 'client' to catchQR.

        // Let's print the arguments of catchQR to see what we get.

        const client = await wppconnect.create({
            session: 'test-pairing',
            headless: true,
            logQR: false,
            catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
                console.log('QR Received. attempts:', attempts);
                // We don't have the client here usually.
            },
            statusFind: (status, session) => {
                console.log('Status:', status);
            }
        });

        console.log('Client created (login success?)');

    } catch (e) {
        console.error('Error:', e);
    }
})();
