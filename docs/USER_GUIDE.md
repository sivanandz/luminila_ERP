# Luminila Inventory Management System
# Comprehensive User Guide

**Version 2.0.0** | Last Updated: January 4, 2026

Welcome to Luminila, the premium inventory management system designed specifically for fashion jewelry brands.

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Setup Instructions](#setup-instructions)
3. [Getting Started](#getting-started)
4. [Core Features](#core-features)
   - [Dashboard](#dashboard)
   - [Inventory Management](#inventory-management)
   - [Point of Sale (PoS)](#point-of-sale-pos)
   - [Barcode Labels](#barcode-labels)
   - [Order Management](#order-management)
   - [WhatsApp Integration](#whatsapp-integration)
   - [Settings & Configuration](#settings--configuration)
5. [Advanced Features](#advanced-features)
   - [Multi-Channel Sync](#multi-channel-sync)
   - [Bulk Operations](#bulk-operations)
   - [Backup & Restore](#backup--restore)
6. [Usage Examples](#usage-examples)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)
9. [Support & Resources](#support--resources)

---

## 🎯 System Overview

Luminila is a comprehensive inventory management system built specifically for fashion jewelry brands.

## 🔧 Troubleshooting

### Common Issues and Solutions

#### Installation Problems

**Issue**: Installer fails to run
- **Solution**: Ensure you have administrator privileges
- **Solution**: Disable antivirus temporarily during installation
- **Solution**: Download installer again in case of corruption

**Issue**: Application doesn't launch after installation
- **Solution**: Check system requirements are met
- **Solution**: Restart your computer
- **Solution**: Reinstall the application

#### Database Connection Issues

**Issue**: "Cannot connect to database" error
- **Solution**: Verify Supabase URL and API key in Settings
- **Solution**: Check internet connection
- **Solution**: Test connection using Supabase dashboard
- **Solution**: Restart Luminila application

#### Point of Sale Problems

**Issue**: Camera not working for barcode scanning
- **Solution**: Check browser/camera permissions
- **Solution**: Ensure no other app is using camera
- **Solution**: Try different browser or restart computer
- **Solution**: Use manual search as alternative

#### WhatsApp Integration Issues

**Issue**: WhatsApp connection fails
- **Solution**: Ensure WhatsApp Business app is installed
- **Solution**: Check phone internet connection
- **Solution**: Restart QR code scanning process
- **Solution**: Verify WhatsApp account is active

#### Performance Issues

**Issue**: Application running slowly
- **Solution**: Close other memory-intensive applications
- **Solution**: Clear browser cache (if web version)
- **Solution**: Restart Luminila application
- **Solution**: Check for available updates

---

## ❓ FAQ

### General Questions

**Q: What platforms does Luminila support?**
A: Luminila supports Windows 10/11, macOS 12+, and Linux (Ubuntu 22.04+ recommended).

**Q: Can I use Luminila offline?**
A: Limited offline functionality is available. Full offline mode is planned for future releases.

**Q: How much does Luminila cost?**
A: Luminila offers a free tier with basic features. Premium features require a subscription.

---

## 🆘 Support & Resources

### Getting Help

**Official Support**:
- Email: support@zennila.com
- Response time: 24-48 hours (business days)

**Documentation**:
- This User Guide (you're reading it!)
- Technical Report: [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md)
- Supabase Setup Guide: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)

---

**Thank you for choosing Luminila!**

We're committed to helping your fashion jewelry business thrive with our comprehensive inventory management solution. If you have any questions or need assistance, don't hesitate to contact our support team.

Happy managing! 💍✨

## 🛠️ Setup Instructions

### Prerequisites

Before installing Luminila, ensure you have:

- **Windows 10/11, macOS 12+, or Linux** (Ubuntu 22.04+ recommended)
- **Minimum 4GB RAM** (8GB recommended for optimal performance)
- **2GB free disk space**
- **Active internet connection** for initial setup and sync
- **Supabase account** (free tier available at [supabase.com](https://supabase.com))

### Installation

#### Option 1: Pre-built Installer (Recommended)

1. **Download the installer** from our website or GitHub releases
2. **Run the installer** and follow the on-screen instructions
3. **Launch Luminila** from your desktop or applications menu

#### Option 2: Development Setup (For Developers)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/luminila_inv_mgmt.git
   cd luminila_inv_mgmt
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp env.example.txt .env.local
   # Edit .env.local with your Supabase credentials
   ```

4. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

### Database Setup

Luminila requires a Supabase PostgreSQL database. Follow these steps:

1. **Create a Supabase project**:
   - Go to [supabase.com](https://supabase.com) and sign in
   - Click **New Project** and enter:
     - **Name**: `luminila-inventory`
     - **Database Password**: Choose a strong password
     - **Region**: Select the region closest to you
   - Click **Create new project** and wait 2-3 minutes

2. **Get API credentials**:
   - In Supabase dashboard, go to **Settings → API Keys**
   - Copy:
     - **Project URL** (e.g., `https://xxxxx.supabase.co`)
     - **Publishable key** (starts with `sb_publishable_...`)

3. **Configure Luminila**:
   - Open Luminila and go to **Settings → Integrations**
   - Enter your Supabase URL and Publishable Key
   - Click **Test Connection**, then **Save**

4. **Run database migrations**:
   - In Supabase dashboard, go to **SQL Editor → New query**
   - Copy and paste contents of `supabase/migrations/001_initial_schema.sql` and run
   - Then paste and run `supabase/migrations/002_stock_functions.sql`

---

## 🚀 Getting Started

### First Launch

When you first open Luminila, you'll see the **Dashboard** with:

- **Today's Sales Summary**: Revenue and transaction count
- **Low Stock Alerts**: Products below your threshold
- **Recent Transactions**: Latest sales across all channels
- **Quick Action Buttons**: Fast access to common tasks

### Navigation

Luminila uses a sidebar navigation system:

- **🏠 Dashboard**: Overview and analytics
- **📦 Inventory**: Product management
- **💰 Point of Sale**: Sales interface
- **🏷️ Labels**: Barcode printing
- **📋 Orders**: Order tracking
- **💬 WhatsApp**: Customer messaging
- **⚙️ Settings**: Configuration

## ✨ Core Features

### Dashboard

The dashboard provides an at-a-glance view of your business:

- **Key Metrics**: Total products, today's sales, revenue, low stock items
- **Sales Charts**: Visual representation of sales trends
- **Quick Actions**: Add product, start sale, print labels
- **Recent Activity**: Latest inventory changes and sales

### Inventory Management

#### Add New Product

1. Click **Add Product** button (top-right)
2. Fill in product details:
   - **SKU**: Unique identifier (e.g., `LUM-EAR-001`)
   - **Name**: Product name (e.g., "Pearl Drop Earrings")
   - **Category**: Select from dropdown (Earrings, Necklaces, Bracelets, Rings, etc.)
   - **Base Price**: Default price for the product
   - **Description**: Detailed product description
   - **Image**: Upload product image (optional)

3. **Add Variants** (for products with multiple options):
   - Click **Add Variant**
   - Specify variant attributes:
     - **SKU Suffix**: Unique variant identifier (e.g., "GP-S")
     - **Variant Name**: Display name (e.g., "Gold Small")
     - **Attributes**: Size, Color, Material as applicable
     - **Stock Level**: Current inventory count
     - **Price Adjustment**: Additional cost for this variant

4. Click **Create Product** to save

### Point of Sale (PoS)

#### Complete Sale

1. Review cart items and totals
2. Select payment method (Cash, Card, UPI, etc.)
3. Enter received amount (for cash payments)
4. Click **Complete Sale**
5. Choose to print receipt or send digital copy

### Barcode Labels

#### Generate Labels

1. Go to **Labels** page
2. Select products to print:
   - Check individual products
   - Use **Select All** for bulk selection
3. Set quantity per product (default: 1)
4. Click **Add to Queue**
5. Review label queue
6. Click **Print Labels**

**Label Requirements**:
- Use **2" x 1" thermal labels** for best results
- Ensure printer is properly configured
- Test print alignment before bulk printing

### Order Management

#### Order Statuses

- **Pending**: New order, not yet processed
- **Confirmed**: Order verified and accepted
- **Shipped**: Items dispatched to customer
- **Delivered**: Order received by customer
- **Cancelled**: Order cancelled (red indicator)

### WhatsApp Integration

#### Connect WhatsApp

1. Go to **WhatsApp** page
2. Click **Connect** button
3. Scan QR code with your WhatsApp Business app
4. Wait for connection confirmation

**Connection Tips**:
- Use WhatsApp Business account for best results
- Ensure phone has stable internet connection
- Keep QR code visible until connection completes

---

## 📖 Usage Examples

### Example 1: Adding a New Product Line

**Scenario**: You're launching a new collection of gold-plated earrings.

**Steps**:
1. Go to **Inventory → Add Product**
2. Enter product details:
   - SKU: `LUM-EAR-025`
   - Name: "Gold-Plated Hoop Earrings"
   - Category: Earrings
   - Base Price: ₹1,499
   - Description: "Elegant gold-plated hoop earrings with secure clasp"
3. Add variants:
   - Small (30mm): SKU `LUM-EAR-025-S`, Stock: 25
   - Medium (40mm): SKU `LUM-EAR-025-M`, Stock: 20, +₹200
   - Large (50mm): SKU `LUM-EAR-025-L`, Stock: 15, +₹400
4. Click **Create Product**
5. Go to **Labels** and print barcode labels for all variants

### Example 2: Processing a WhatsApp Order

**Scenario**: A customer sends a WhatsApp message: "I want to order 2 pairs of LUM-EAR-001-GP-S and 1 LUM-NEC-023-18"

**Steps**:
1. Luminila auto-detects the order intent and SKUs
2. System sends auto-reply: "Thank you for your order! Processing 2x Pearl Drop Earrings (Gold Small) and 1x Layered Chain Necklace (18"). Is this correct?"
3. Customer confirms with "Yes"
4. Go to **Orders** page to see the new order
5. Click **Confirm Order** and update status to "Confirmed"
6. Prepare items for shipping
7. Update status to "Shipped" and send shipping confirmation via WhatsApp