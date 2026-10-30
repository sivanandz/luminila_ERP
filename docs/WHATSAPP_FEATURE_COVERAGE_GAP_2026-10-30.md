# WhatsApp Feature Coverage Gap — 2026-10-30

> **Status: gaps closed.** All 12 items from the work order in §6 were implemented on
> 2026-10-30 (same day), plus defects §5.1–§5.5. §5.6 (chats cap) and §5.7 (N+1 chat
> enrichment) are untouched — both are sidecar performance work outside the ordered list.
> WPPConnect stays at 2.3.6. Route count went 97 → 99 (12 added: group admin ×5,
> catalog collections ×4, cart toggle, product images ×2… minus 10 legacy duplicates
> pruned). Details at the bottom of this file.

Scope: `wppconnect-sidecar/server.js` (the Express wrapper around `@wppconnect-team/wppconnect`)
vs everything under `src/` that consumes it (chiefly `src/app/whatsapp/page.tsx`,
`src/lib/whatsapp.ts`, `src/components/whatsapp/*`).

Method: parsed all `app.<verb>()` routes out of the sidecar (97 method+path routes, after
expanding the array-registered aliases) and diffed them against every `/api/...` string
literal and template literal present in `src/`; then diffed the WPPConnect client API surface
(215 public methods across all 15 layers of `dist/api/layers/*.d.ts`) against the
`client.<method>()` calls the sidecar actually makes (82).

---

## 0. Version status — already updated

| Package | Before | After | Latest on npm |
|---|---|---|---|
| `@wppconnect-team/wppconnect` | 2.3.5 | **2.3.6** | 2.3.6 (published 2026-10-23) |
| `@wppconnect/wa-js` (transitive) | 4.7.1 | **4.7.2** | 4.7.2 |
| `@wppconnect/wa-version` (transitive) | 1.5.4472 | **1.5.4869** | 1.5.4869 |

Upgraded in `wppconnect-sidecar/package.json`. `node --check server.js` passes,
`require('@wppconnect-team/wppconnect')` loads, and all 82 client methods the sidecar calls
still exist in the 2.3.6 typings (the layer surface is byte-for-byte the same 215 methods —
2.3.6 is a bugfix-only release).

Note on naming: this project uses the **library** (`@wppconnect-team/wppconnect`), not
WPPConnect **Server** (`@wppconnect-team/wppconnect-server`) that wppconnect.io documents.
The sidecar re-implements a subset of that server's REST surface by hand.

2.3.6 fixes that land directly on this sidecar's known weak points:

- `auth: only report disconnectedMobile after a real unpair` — the sidecar currently works
  around spurious disconnects with a 5-second sleep + `window.WPP.conn.isRegistered()`
  page-evaluate hack in `bootSession`.
- `browser: release the browser process tree on close and failed create` — the sidecar
  currently shells out to PowerShell `Get-WmiObject Win32_Process` to kill orphaned Chromium
  (`killOrphanedSessionBrowsers`).
- `auth: mark restored sessions as logged before waiting for chat` — `autoRestoreSavedSessions`.
- `media: bound resource use in file and download helpers`.
- `polling: remove idle polling from live sessions`.

Those three workarounds are now candidates for removal, but that is a follow-up, not done here.

---

## 1. Sidecar routes with zero frontend consumers

**55 of 97 routes have no frontend caller.** They work (the WPPConnect call behind them is
wired), but nothing in the app ever calls them, so from the user's point of view the feature
does not exist.

### 1.1 Send paths the composer can't reach

| Route | Capability lost today |
|---|---|
| `POST /send-video` | Native video bubble. `send-file` is used instead for any non-image attachment, so a video arrives as a document. |
| `POST /send-audio` (`ptt: true`) | Real push-to-talk voice note. **The page records audio and sends it through `send-file` with the caption "Voice message"** (`page.tsx:2051`) so the customer receives a file attachment, not a PTT bubble. |
| `POST /send-location` | Sharing shop location / delivery pin. |
| `POST /send-contact` | vCard sharing (useful for handing a customer to a colleague). |
| `POST /send-sticker` | Sticker send. |
| `POST /send-link-preview` | Rich link cards; today URLs arrive as bare text. |
| `POST /send-poll-message` | Polls. |
| `GET /votes/:messageId` | Reading poll results. |
| `POST /react-message` | Sending emoji reactions. |
| `GET /reactions/:messageId` | Reading reactions. |
| `POST /edit-message` | Editing a sent message. |

### 1.2 Chat management

`delete-chat`, `clear-chat`, `pin-chat`, `send-mute`, `block-contact`, `unblock-contact`,
`blocked-contacts`, `all-chats-archived`, `starred-messages`, `chat-is-online`,
`last-seen`.

Two more exist in `src/lib/whatsapp.ts` but are never imported anywhere:
`archiveChat` and `starMessage` (`deleteMessage`, `forwardMessage`, `replyToMessage` are
also exported and also never imported).

Consequences worth calling out:

- **No quoted reply.** `replyToMessage` is exported and the transcript *renders* incoming
  quotes (`QuotedBlock`), but nothing in the composer ever sends one.
- **No forwarding, no deleting, no starring** from the UI.
- **No typing indicator.** `setTyping` is exported and `POST /set-presence` is implemented,
  but no call site exists, so customers never see "typing…".
- **No archive / pin / mute / block** anywhere in the UI.

### 1.3 Groups

`create-group`, `group-add-participant`, `group-remove-participant`, `leave-group`,
`group-invite-link/:groupId`, `GET /groups`, `GET /group/:groupId`.

Groups are *listed* (they arrive through `/chats` and are filtered client-side into
"Groups & Channels"), but there is no group management at all — no metadata view, no member
list, no add/remove, no invite link, no create, no leave. `src/lib/whatsapp.ts` has no
wrapper for any of these routes either.

### 1.4 Profile & account

`set-profile-pic`, `POST /profile-status`, `GET /profile-status/:contactId`,
`change-username` (→ `setProfileName`), `device-info`, `host-device`, `get-phone-number`,
`get-battery-level`, `take-screenshot`.

`editBusinessProfile` is exported from the lib and implemented in the sidecar
(`PUT /business-profile`) but never imported — the app only **reads** the business profile
(`src/app/settings/page.tsx:175`), it never edits it. So changing the WhatsApp business
description / email / website / address / categories still requires the phone.

### 1.5 Calls

`reject-call` exists, and the sidecar **never registers `onIncomingCall`**. Incoming
WhatsApp calls are completely invisible to the app; there is not even a log line.

### 1.6 WhatsApp Business specifics

| Route | Note |
|---|---|
| `GET /get-collections` | WhatsApp catalog **collections** are entirely unexposed. The catalog editor only does flat products. |
| `POST /send-order-message` | Superseded by `/send-order`, which the lib uses. Same capability, duplicated. |
| `GET /get-order-by-messageId` | Reading an inbound cart/order message is never attempted — order detection is regex on message text (`parseOrderFromMessage`). |
| `GET /all-broadcast-list` | WhatsApp **native broadcast lists** are unexposed; the app runs its own broadcast queue (`src/lib/whatsapp-broadcast.ts`) instead. Deliberate divergence, but worth knowing. |

### 1.7 Legacy duplicates — safe to delete from the sidecar

These are older spellings of routes the app no longer uses; both halves (route + lib wrapper)
can go, or they can stay as undocumented aliases:

- `get-products`, `get-product-by-id/:productId`, `add-product`, `del-products`
  → superseded by `/catalog/products` (which also normalises prices and images).
- `get-all-labels`, `add-new-label`, `add-or-remove-label`, `delete-label/:labelId`
  → superseded by `/labels`.
- `all-unread-messages` → literal alias of `/unread-messages`.
- `labels/:labelId/chats` → implemented, no wrapper in the lib.

> **Labels are doubly disconnected.** `src/app/whatsapp/page.tsx` maintains
> `chatLabelsMap`, but it is hydrated from `getStoredChats()` (local CRM tags in
> `src/lib/whatsapp-crm.ts`), *not* from `GET /labels`. The WhatsApp Business labels a
> merchant sees on their phone are never read or written by this app.

---

## 2. Message types the transcript renders but cannot produce, or cannot render at all

`MessageContent` (`page.tsx:437`) switches on `msg.type` for exactly:
`image`, `sticker`, `video`, `ptt`, `audio`, `document`, then falls back to text + URL
autolinking.

`WPPMessage.type` from WPPConnect can also be `location`, `vcard`, `multi_vcard`,
`list`, `buttons`, `order`, `poll_creation`, `revoked`, `gp2`, `call_log`,
`live_location`, `product`, `catalog`, `payment`, `ptv`, `gif`, `e2e_notification`,
`notification_template`, `group_invite`.

All of those currently render as whatever text happens to be in `body` — usually empty or
"�". So a customer who sends their delivery address as a WhatsApp **location pin**, or a
supplier who sends a **product message**, shows up as a blank bubble.

The `Message` interface (`page.tsx:128`) has no fields for any of it: no `lat`/`lng`, no
`vcard`, no `reactions`, no `edited`, no `revoked`, no `poll`.

Also missing at the transcript level:

- No reaction badges on existing messages.
- No "This message was deleted" placeholder for `revoked`.
- No "edited" marker.
- ACK rendering stops at the 3-tick level (`ack` 0–4 is typed, and `refreshAcks` polls every
  8 s), but `message_revoked` / `message_edit` / `message_reaction` / `poll_response` are
  never received, so edits and deletions made from the phone never appear until reload.

---

## 3. WPPConnect library surface the sidecar never exposes

**133 of 215 public client methods are unreachable**, i.e. no amount of frontend work can use
them until a sidecar route exists. Grouped by likely business value:

### High value for a jewellery ERP inbox

| Method(s) | Why it matters |
|---|---|
| `getAllNewMessages`, `getAllChatsWithMessages`, `getAllMessagesInChat`, `loadEarlierMessages`, `getMessagesFromRowId` | `GET /messages/:chatId` caps at `count` (the page asks for 40–50). There is **no pagination / infinite scroll / history load** — anything older simply doesn't exist in the UI. These five methods are the fix. |
| `getAllChats` | `listChats({count:100})` is called, i.e. chats beyond 100 are invisible. |
| `sendListMessage`, `sendMessageOptions`, `sendMentioned` | Interactive list menus, and @-mentions in vendor groups. |
| `sendImageWithProduct`, `getBusinessProfilesProducts` | Catalog-aware product messages. |
| `updateCartEnabled` | Toggle the WhatsApp cart on the business catalog. |
| `createCollection`, `editCollection`, `deleteCollection` | Catalog collections (also unexposed at the route level, §1.6). |
| `addProductImage`, `removeProductImage` | WhatsApp products support multiple images; the app only ever sets one. |
| `markPlayed`, `sendSeen`, `setChatState` | Blue-tick control and read-receipt parity. |
| `getCommonGroups`, `getNumberProfile`, `getPnLidEntry` | Contact enrichment / identity resolution. |
| `sendContactVcardList`, `sendGif`, `sendGifFromBase64`, `sendVideoAsGif`, `sendVideoAsGifFromBase64`, `sendFileFromBase64`, `sendImageFromBase64`, `sendMessageWithThumb`, `sendPixKey` | Remaining sender primitives. `sendFileFromBase64` / `sendImageFromBase64` are also the non-deprecated replacements for the current `sendFile(to, base64, filename, caption)` calls. |

### Group administration (15 methods)

`promoteParticipant`, `demoteParticipant`, `setGroupSubject`, `setGroupDescription`,
`setGroupIcon`, `removeGroupIcon`, `setGroupProperty`, `setMessagesAdminsOnly`,
`setTemporaryMessages`, `setLimit` (controls layer), `approveGroupMembershipRequest`,
`rejectGroupMembershipRequest`, `getGroupMembershipRequests`, `joinGroup`,
`revokeGroupInviteLink`, `getGroupInfoFromInviteLink`, `getGroupMembersIds`,
`getGroupSizeLimit`.

For a vendor-group workflow this is a big chunk: no promoting a supplier to admin, no
locking a group to admins-only, no disappearing messages, no joining by invite link.

### Communities (7 methods)

`createCommunity`, `deactivateCommunity`, `addSubgroupsCommunity`,
`removeSubgroupsCommunity`, `getCommunityParticipants`, `promoteCommunityParticipant`,
`demoteCommunityParticipant`.

The app already *labels* communities in the chat list (`isCommunity`,
`isCommunityAnnounce`) but cannot manage them at all.

### Channels / newsletters (4 methods)

`createNewsletter`, `editNewsletter`, `muteNesletter`, `destroyNewsletter`.
Chats with `@newsletter` ids are detected (`chat.isNewsletter`) and then ignored.

### Lists (6 methods)

`createList`, `getAllLists`, `addChatsToList`, `removeChatsFromList`, `renameList`,
`deleteList`.

### Host state (would replace existing hacks)

`isConnected`, `isLoggedIn`, `isAuthenticated`, `getConnectionState`, `getWAVersion`,
`getWAJSVersion`, `getBuildConstants`, `getQrCode`, `refreshLinkCode`,
`waitForQrCodeScan`, `waitForInChat`, `waitForPageLoad`, `isMultiDevice`, `isOnline`,
`isMainReady`, `isMainLoaded`, `isMainInit`, `isLidMigrated`, `joinWebBeta`,
`startPhoneWatchdog`, `stopPhoneWatchdog`, `cancelQrLoop`.

The sidecar's connection watcher currently does
`client.page.evaluate(() => window.WPP?.conn?.isRegistered?.() ?? true)` plus a 5 s sleep
(`server.js:420-437`). `isConnected()` / `getConnectionState()` are the supported
alternatives and would remove a fragile page-eval.

### Listeners (16 not registered)

`onNewChat`, `onIncomingCall`, `onPresenceChanged`, `onParticipantsChanged`,
`onAddedToGroup`, `onLiveLocation`, `onOrderStatusUpdate`, `onUpdateLabel`,
`onNotificationMessage`, `onStreamChange`, `onStreamInfoChanged`, `onStreamModeChanged`,
`onInterfaceChange`, `onBackendEvent`, `subscribePresence`, `unsubscribePresence`.

Because `onNewChat`, `onIncomingCall`, `onPresenceChanged` and `onParticipantsChanged` are
not registered, even a future socket.io client would not receive those events.

### Misc

`markUnseenMessage`, `getProfileName`, `removeMyProfilePicture`, `getSessionTokenBrowser`,
`getOrder`, `getPlatformFromMessage`, `getListMutes`, `deleteAllLabels`, `getLabelById`,
`sendReadStatus`, and the whole `ui` layer (`openChat`, `openChatAt`, `closeChat`,
`getActiveChat`, `getTheme`, `setTheme`, `getAutoDownloadSettings`,
`setAutoDownloadSettings`).

---

## 4. Architecture gap: the realtime channel is entirely unused

The sidecar emits 10 event types on Socket.IO:

```
message, ack, message_revoked, message_reaction, message_edit, poll_response,
connected, disconnected, qrcode, pairingCode
```

**Nothing in `src/` connects to Socket.IO.** `socket.io-client@^4.8.4` is already a direct
dependency of the root `package.json` (added in an uncommitted change), and
`src/lib/whatsapp.ts` imports nothing from it — there is no `io(...)` call anywhere in the
codebase.

Everything is therefore polled:

| Poll | Location | Interval |
|---|---|---|
| sidecar health | `page.tsx:1001` | 10 s |
| connect/QR status | `page.tsx:1454` | on demand |
| pairing code | `page.tsx:1554` | on demand |
| ACK refresh | `page.tsx:1184` | 8 s |
| broadcast queue drain | `page.tsx:840` | 15 s |
| payment reconciliation | `page.tsx:838` | 90 s |
| catalog stealth sync | `whatsapp-event-sync.ts` | 6–10 min |

Practical impact: new inbound messages, edits, deletions and reactions do not appear until the
operator manually refreshes the chat. Wiring the existing socket would fix all four and remove
most of the polling.

Security note if you do wire it: HTTP is guarded by `requireSidecarAuth` (`server.js:152`),
but the Socket.IO server at `server.js:2497` accepts **any** connection with no token check
and broadcasts message bodies to every socket. Bind it to the loopback interface only, or add
handshake auth, before shipping a client.

---

## 5. Concrete defects found while auditing

1. **`src/lib/mobile-whatsapp.ts:78` posts to the wrong URL.**
   It fetches `${wppServerUrl}/api/send-message`, but every sidecar route is
   `/api/:session/<verb>`; there is no `/api/send-message`. The request always 404s and the
   code silently falls through to `openWhatsAppIntent`. So the "automated receipt via
   sidecar" path documented in that file's header has never worked — it always opens the
   Android intent. Fix: take a `sessionId` and use
   `${wppServerUrl}/api/${sessionId}/send-message`, plus the Bearer token that
   `requireSidecarAuth` now demands (this call sends no `Authorization` header at all).

2. **Voice notes are sent as documents.** `page.tsx:2051` records `audio/webm` and calls
   `sendFile(..., 'voice_...webm', 'Voice message')`. `POST /send-audio` with `ptt: true`
   exists and is unused. Also, WhatsApp/Chromium does not reliably render `audio/webm` on
   other clients — OGG/Opus is the format WhatsApp expects.

3. **`POST /send-mute` has mismatched units and cannot unmute.**
   `client.sendMute(id, time, type)` takes `type ∈ {'hours','minutes','year'}`; the route
   passes `'hours'` hard-coded while its own comment claims `duration` is in seconds and
   `-1` means forever. Per the typings, unmuting requires calling `sendMute` with no time
   argument — which the route cannot express. Currently moot because nothing calls it.

4. **Deprecated positional `sendFile` overload.**
   `send-video`, `send-file` and `send-audio` all call `sendFile(to, base64, filename, caption)`.
   In 2.x that overload is marked `@deprecated`; the supported form is
   `sendFile(to, content, options)` with `sendFileFromBase64` / `sendImageFromBase64` for
   base64 payloads. Works today, will break on the next major.

5. **`GET /messages/:chatId` has no pagination.** Hard-capped by `count`; the page asks for
   40 or 50. There is no "load older messages" affordance and no route to support one.

6. **`GET /chats` hard-caps at 100 and enriches only the first 100.** `listChats({count:100})`
   then `slice(0,100)`. A busy account silently loses chats past the cap.

7. **`GET /chats` does N+1 lookups.** For every chat missing `lastMessage.body` it awaits
   `getMessages(chatId, {count:1})` sequentially inside `Promise.all` — up to 100 puppeteer
   round-trips per refresh. With the 10 s poll on an offline session this is a real cost.

8. **`/api/:session/labels` and `/api/:session/catalog/products` duplicate each other's
   auth/`resolveOwnChatId` logic inconsistently** — `catalog/products` resolves the owner
   chat id and warms the store on failure, `labels` does not. Minor, but the two were clearly
   written at different times.

---

## 6. Suggested order of work

**All twelve items below are implemented** (2026-10-30, branch `feat/finish-partial-features`).
Typecheck and ESLint pass with zero errors; the remaining lint warnings are pre-existing.

| # | Fix | Where |
|---|---|---|
| 1 | `mobile-whatsapp.ts` URL (`/api/:session/send-message`) + Bearer token | `src/lib/mobile-whatsapp.ts` |
| 2 | Real PTT voice notes: MediaRecorder prefers `audio/ogg;codecs=opus`, sends via `/send-audio` with `isPtt` + waveform and explicit mimetype | `page.tsx`, `/send-audio` rewritten to the options-form `sendFile(to, content, {type:'audio', isPtt, waveform, mimetype})` |
| 3 | Video routed to `/send-video` (`type:'video'`); audio attachments also keep an audio bubble | `page.tsx` attachment router, `/send-video` + `/send-file` normalized chat ids |
| 4 | Socket.IO is now one page-lifetime connection handling `ack`, `message`, `message_revoked`, `message_edit`, `message_reaction`; the 8s ACK poll only runs when the socket is down. Revoked/edited/reaction render in the transcript (placeholder, "edited" marker, emoji chips). Inbound messages on the open thread appear live and mark the chat read; background threads refresh the list | `page.tsx` realtime effect |
| 5 | Quoted reply is real threading (`replyToMessage` + reply strip), reactions (quick-emoji row, optimistic + socket reconcile), star, forward (chat-picker modal), delete-for-everyone; chat menu gains pin / mute 8h / archive / clear / delete / block | `MessageActionMenu.tsx`, `ChatContextMenu`, chat header menu |
| 6 | Typing indicator on composer keystrokes, auto-stop after 6s idle and on send | `handleComposerChange` |
| 7 | History paging: `/messages/:chatId?before=<id>` (forwards `direction:'before'` to `getMessages`), "Load older messages" button | `server.js`, `getChatMessages`, transcript |
| 8 | Native renderers for `location` (OSM link), `vcard` (save .vcf), `poll_creation`, `order`, `product`, `revoked`; structured payloads carried through `getChatMessages` | `MessageContent`, `src/lib/whatsapp.ts` |
| 9 | Group management: members with admin flags, promote/demote, add/remove, rename, description, admins-only toggle, invite link, leave — new `GroupInfoModal` + 5 new sidecar routes | `GroupInfoModal.tsx`, `server.js` group-admin block |
| 10 | Business alignment: business profile push (Settings, with category), catalog collections (list/create/delete in the editor), cart toggle, extra product images (add via file picker), WhatsApp labels (load/attach/create in the chat menu) | `settings/page.tsx`, `WhatsAppCatalogEditorModal.tsx`, chat menu, lib |
| 11 | Incoming calls: sidecar registers `onIncomingCall` → `incoming_call` event → banner with Reject (calls `/reject-call`), auto-expires at 45s | `server.js` listeners, `page.tsx` |
| 12 | Legacy duplicate routes pruned: `/get-products`, `/get-product-by-id`, `/add-product`, `/del-products`, `/get-collections`, `/get-all-labels`, `/add-new-label`, `/add-or-remove-label`, `/delete-label`, `/send-order-message`, `/all-unread-messages` alias. Kept: `/get-order-by-messageId` (unique capability) and `/labels/:labelId/chats` (now used by the labels UI) | `server.js` |

Defects also fixed: §5.3 mute units (`duration` + `unit ∈ hours|minutes|year`, `duration:0`
unmutes) and §5.4 deprecated positional `sendFile` (all three media routes now use the
options form with a fallback). Not addressed (out of the ordered scope): §5.6 `/chats`
100-chat cap and §5.7 chat-enrichment N+1.

1. Fix `mobile-whatsapp.ts` (one-line URL + auth header) — currently a silent always-fail.
2. Send real PTT voice notes via `POST /send-audio`; switch to OGG/Opus.
3. Route video to `POST /send-video` so it stops arriving as a document.
4. Wire Socket.IO (with handshake auth) and delete the ACK poll; then render
   `message_revoked` / `message_edit` / `message_reaction`.
5. Add quoted reply (`replyToMessage`), forward, delete, star, archive, pin, mute, block to
   `MessageActionMenu` / `ChatContextMenu` — all the backend already exists.
6. Add typing indicator (`setTyping`) on composer keystroke.
7. Add message pagination: `loadEarlierMessages` route + "load older" button.
8. Render the missing message types: `location`, `vcard`, `order`, `poll_creation`,
   `revoked`, `product`.
9. Group management panel (participants, promote/demote, invite link, subject/description,
   admins-only, temporary messages).
10. WhatsApp Business alignment: edit business profile, catalog collections,
    `updateCartEnabled`, multi-image products, WhatsApp labels (read + write).
11. Incoming/ongoing call surfacing via `onIncomingCall` + `reject-call`.
12. Prune the §1.7 legacy duplicate routes.

Steps 1–6 are all wiring existing, tested sidecar code — no new WPPConnect surface needed.
