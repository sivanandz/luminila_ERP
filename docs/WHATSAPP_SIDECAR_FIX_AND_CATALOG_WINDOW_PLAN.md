# WhatsApp Sidecar Fixes & Dedicated Catalog Editor Plan

## 1. Overview & Objectives
This plan outlines the end-to-end fix for the WPPConnect sidecar service and the delivery of a dedicated WhatsApp Catalog Editing Window with bi-directional inventory synchronization.

---

## 2. Phase 1: Sidecar Endpoint Fixes & Method Corrections (`wppconnect-sidecar/server.js`)

### 2.1 Replace Non-Existent Client Method Calls
1. **Message Reactions (`POST /api/:session/react-message`)**:
   - Change `client.sendReaction(messageId, reaction)` -> `client.sendReactionToMessage(messageId, reaction)`.
2. **Chat Unarchive (`POST /api/:session/archive-chat`)**:
   - Change `client.unarchiveChat(chatId)` -> `client.archiveChat(chatId, false)`.
3. **Starred Messages (`GET /api/:session/starred-messages`)**:
   - Implement via in-browser evaluation: `window.WPP?.chat?.getStarredMessages()` / `window.Store?.Msg?.models.filter(m => m.star)`.
4. **Group Info Retrieval (`GET /api/:session/group/:groupId`)**:
   - Change `client.getGroupInfo(groupId)` -> `WPP.group.getGroupMetadata(groupId)` with fallback to `client.getGroupMembers(groupId)` and `client.getGroupAdmins(groupId)`.
5. **Delete Products from Catalog (`POST /api/:session/del-products`)**:
   - Change `client.deleteProduct(productIds)` -> `client.delProducts(Array.isArray(productIds) ? productIds : [productIds])`.
6. **Fetch Single Catalog Product (`GET /api/:session/catalog/products/:productId`)**:
   - Change `client.getProduct(productId)` -> `client.getProductById(productId)`.
7. **Archived Chats Retrieval (`GET /api/:session/all-chats-archived`)**:
   - Change `client.getArchivedChats()` -> `client.listChats({ only: 'archived' })` with `window.WPP?.chat?.list({ only: 'archived' })` fallback.
8. **Mute Chat (`POST /api/:session/send-mute`)**:
   - Change `client.muteChat(chatId, duration)` -> `client.sendMute(chatId, duration, 'hours')`.
9. **Label Chats Filter (`GET /api/:session/labels/:labelId/chats`)**:
   - Replace `client.getChatsByLabelId(labelId)` with browser store query `window.WPP?.labels?.getChatsByLabel(labelId)`.
10. **Host Device / Self Identity (`GET /api/:session/status`)**:
    - Change `client.getMe()` -> `client.getHostDevice()`.

### 2.2 Fix Route Discrepancies & Audio Payloads
11. **Unread Messages Route Alias**:
    - Support both `GET /api/:session/unread-messages` and `GET /api/:session/all-unread-messages`.
12. **Audio/PTT Base64 Handling (`POST /api/:session/send-audio`)**:
    - Detect `data:audio` or raw base64 and invoke `client.sendPttFromBase64(phone, base64)` instead of `client.sendPtt()`.
13. **De-duplicate Route Registrations**:
    - Clean up duplicate registrations of `/close` and `/logout`.

---

## 3. Phase 2: Missing Real-Time Event Pipeline (`wppconnect-sidecar/server.js`)
Expand `attachClientListeners` to listen to essential WhatsApp Web events and emit them over Socket.IO:
- `client.onAnyMessage((msg) => io.emit('message', { session, message: payload }))`: Captures messages sent directly from the physical WhatsApp phone.
- `client.onRevokedMessage((revoked) => io.emit('message_revoked', { session, revoked }))`: Propagates "delete for everyone".
- `client.onReactionMessage((reaction) => io.emit('message_reaction', { session, reaction }))`: Syncs live emoji reactions.
- `client.onMessageEdit((edited) => io.emit('message_edit', { session, edited }))`: Emits message edits.
- `client.onPollResponse((poll) => io.emit('poll_response', { session, poll }))`: Streams poll voting updates.

---

## 4. Phase 3: Dedicated WhatsApp Catalog Editing Window (`src/components/whatsapp/WhatsAppCatalogEditorModal.tsx`)

A dedicated catalog management and live editing workspace:
1. **Catalog Overview & Inventory Sync Status**:
   - View all WhatsApp Business Catalog products live from WhatsApp (`getCatalogProducts`).
   - Match each item with Luminila's local PocketBase inventory (`products` table) by SKU or `whatsapp_catalog_id`.
   - Badges: `Synced`, `Unlinked`, `Out of Stock`, `Price Mismatch`, `Hidden on WhatsApp`.
2. **In-Line Catalog Editing**:
   - Edit Title, Description, and WhatsApp Selling Price directly.
   - Toggle visibility (`isHidden: true/false`) without deleting.
   - Instant "Push Updates to WhatsApp" using `editCatalogProduct`.
3. **Inventory Auto-Link & One-Click Sync**:
   - Link unlinked WhatsApp catalog items to existing inventory SKUs via search autocomplete.
   - "Sync Inventory Price & Stock" button: updates WhatsApp catalog price to match WhatsApp channel pricing and marks items hidden/tagged when stock is 0.
4. **Publish New Product Directly**:
   - Form to select an inventory item and publish it immediately to WhatsApp catalog with photo, formatted description, SKU, and direct checkout link.
5. **Delete Products**:
   - Remove products from WhatsApp catalog with instant confirmation.

---

## 5. Phase 4: Integration & Verification
1. Add "Edit WhatsApp Catalog" launcher button in the WhatsApp sidebar and catalog tab.
2. Wire real-time refresh hooks when edits occur.
3. Verify type-safety with `npx tsc --noEmit`.
