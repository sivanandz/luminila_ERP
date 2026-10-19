const PocketBase = require('pocketbase/cjs');
const pb = new PocketBase('http://127.0.0.1:8091');
pb.autoCancellation(false);

const realStoreLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#D4AF37" />
      <stop offset="50%" stop-color="#F3E5AB" />
      <stop offset="100%" stop-color="#AA771C" />
    </linearGradient>
  </defs>
  <g transform="translate(10, 10)">
    <!-- Gem / Temple Ornament Icon -->
    <path d="M 30,5 L 50,25 L 30,55 L 10,25 Z" fill="none" stroke="url(#goldGrad)" stroke-width="2.5" />
    <circle cx="30" cy="25" r="7" fill="url(#goldGrad)" />
    <circle cx="30" cy="8" r="2" fill="#D4AF37" />
    <circle cx="50" cy="25" r="2" fill="#D4AF37" />
    <circle cx="10" cy="25" r="2" fill="#D4AF37" />
    <circle cx="30" cy="52" r="2" fill="#D4AF37" />
  </g>
  <!-- Brand Typography -->
  <text x="75" y="38" font-family="'Cinzel', 'Times New Roman', serif" font-size="24" font-weight="900" letter-spacing="1.5" fill="#1A1A2E">NITHTHIGAL</text>
  <text x="76" y="55" font-family="'Montserrat', 'Segoe UI', sans-serif" font-size="10.5" font-weight="700" letter-spacing="4.5" fill="#B8860B">JEWELLERY</text>
</svg>`;

const logoDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(realStoreLogoSvg)}`;

async function syncRealStoreSettings() {
    console.warn("Deprecated: seed script disabled to prevent overwriting live store settings.");
    return;

    const realSettings = {
        storeName: "Niththigal Jewellery",
        store_name: "Niththigal Jewellery",
        currency: "INR",
        email: "admin@luminila.local",
        store_email: "admin@luminila.local",
        phone: "",
        store_phone: "",
        address: "14, Car Street, Commercial Complex, Bengaluru, Karnataka",
        store_address: "14, Car Street, Commercial Complex",
        store_city: "Bengaluru",
        store_state: "Karnataka",
        store_state_code: "29",
        store_pincode: "560001",
        stateCode: "29",
        gstin: "29AAACN1234F1Z8",
        store_gstin: "29AAACN1234F1Z8",
        pan: "AAACN1234F",
        store_pan: "AAACN1234F",
        bankName: "State Bank of India",
        bank_name: "State Bank of India",
        accountNumber: "40928371928",
        bank_account_no: "40928371928",
        ifsc: "SBIN0001234",
        bank_ifsc: "SBIN0001234",
        branch: "MG Road Main Branch, Bengaluru",
        bank_branch: "MG Road Main Branch, Bengaluru",
        invoicePrefix: "NJ",
        invoice_prefix: "NJ",
        invoiceTerms: "1. Handcrafted imitation and temple jewelry returnable within 7 days against invoice.\n2. Goods must be in unworn condition with barcode tag intact.\n3. Defective items eligible for vendor repair or full replacement.\n4. Subject to Bengaluru jurisdiction.",
        invoice_terms: "1. Handcrafted imitation and temple jewelry returnable within 7 days against invoice.\n2. Goods must be in unworn condition with barcode tag intact.\n3. Defective items eligible for vendor repair or full replacement.\n4. Subject to Bengaluru jurisdiction.",
        invoiceFooter: "Thank you for shopping at Niththigal Jewellery. Authentic craftsmanship & trust.",
        invoice_footer: "Thank you for shopping at Niththigal Jewellery. Authentic craftsmanship & trust.",
        companyLogo: logoDataUri,
        store_logo: logoDataUri,
        defaultPrintMode: "regular",
        default_print_mode: "regular",
        lowStockThreshold: 5
    };

    // Save as store_settings_default JSON blob for settings.ts
    const existingDefault = await pb.collection('store_settings').getFirstListItem('key="store_settings_default"').catch(() => null);
    if (existingDefault) {
        await pb.collection('store_settings').update(existingDefault.id, {
            value: JSON.stringify(realSettings),
            category: 'general'
        });
        console.log('Updated store_settings_default');
    } else {
        await pb.collection('store_settings').create({
            key: 'store_settings_default',
            value: JSON.stringify(realSettings),
            category: 'general'
        });
        console.log('Created store_settings_default');
    }

    // Save individual keys for invoice.ts
    for (const [k, v] of Object.entries(realSettings)) {
        const valStr = typeof v === 'string' ? v : JSON.stringify(v);
        const existingKey = await pb.collection('store_settings').getFirstListItem(`key="${k}"`).catch(() => null);
        if (existingKey) {
            await pb.collection('store_settings').update(existingKey.id, { value: valStr });
        } else {
            await pb.collection('store_settings').create({ key: k, value: valStr, category: 'general' });
        }
    }
    console.log('Synced individual store_settings keys for Niththigal Jewellery!');
}

syncRealStoreSettings().catch(e => {
    console.error('Error syncing real store settings:', e.message, e.data);
    process.exit(1);
});
