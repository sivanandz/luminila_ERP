/// <reference path="../pb_data/types.d.ts" />

/**
 * AI harness collections (2026-10-24).
 *
 * Three server-owned collections:
 * - `ai_providers`: OpenAI-compatible provider configuration. `api_key` is
 *   stored AES-256-GCM encrypted by the server; the browser only ever sees a
 *   masked projection through /api/ai/providers.
 * - `ai_conversations`: one thread per operator conversation.
 * - `ai_events`: the append-only event log the model history is derived from
 *   ("model-visible means logged"). There is no update/delete rule at all.
 *
 * All API rules are null: these collections are reachable only through the
 * Next.js API routes using the server's superuser client. Tenant ownership is
 * enforced in application code from the verified operator session, and the
 * per-tenant PocketBase instances provide physical isolation as well.
 *
 * Fields are added through `fields.add()` calls because PocketBase 0.25's JSVM
 * ignores the `fields` array on the `Collection` constructor (verified against
 * a migrated copy: the collection was created with only its system `id`).
 */

migrate((app) => {
  const providers = new Collection({ name: 'ai_providers', type: 'base' });
  providers.fields.add(new TextField({ name: 'account_email' }));
  providers.fields.add(new TextField({ name: 'created_by' }));
  providers.fields.add(new TextField({ name: 'name' }));
  providers.fields.add(new TextField({ name: 'base_url' }));
  providers.fields.add(new TextField({ name: 'api_key' }));
  providers.fields.add(new TextField({ name: 'model' }));
  providers.fields.add(new JSONField({ name: 'models' }));
  providers.fields.add(new JSONField({ name: 'custom_headers' }));
  providers.fields.add(new NumberField({ name: 'temperature' }));
  providers.fields.add(new NumberField({ name: 'max_tokens' }));
  providers.fields.add(new TextField({ name: 'max_tokens_param' }));
  providers.fields.add(new BoolField({ name: 'supports_tools' }));
  providers.fields.add(new BoolField({ name: 'enabled' }));
  providers.fields.add(new BoolField({ name: 'is_default' }));
  providers.fields.add(new NumberField({ name: 'timeout_ms' }));
  providers.fields.add(new BoolField({ name: 'last_test_ok' }));
  providers.fields.add(new DateField({ name: 'last_tested_at' }));
  providers.fields.add(new AutodateField({ name: 'created', onCreate: true }));
  providers.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
  providers.indexes = ['CREATE INDEX idx_ai_providers_account ON ai_providers (account_email)'];
  providers.listRule = null;
  providers.viewRule = null;
  providers.createRule = null;
  providers.updateRule = null;
  providers.deleteRule = null;
  app.save(providers);

  const conversations = new Collection({ name: 'ai_conversations', type: 'base' });
  conversations.fields.add(new TextField({ name: 'account_email' }));
  conversations.fields.add(new TextField({ name: 'created_by' }));
  conversations.fields.add(new TextField({ name: 'title' }));
  conversations.fields.add(new TextField({ name: 'profile_id' }));
  conversations.fields.add(new TextField({ name: 'provider_id' }));
  conversations.fields.add(new TextField({ name: 'model' }));
  conversations.fields.add(new TextField({ name: 'status' }));
  conversations.fields.add(new BoolField({ name: 'archived' }));
  conversations.fields.add(new DateField({ name: 'last_message_at' }));
  conversations.fields.add(new AutodateField({ name: 'created', onCreate: true }));
  conversations.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
  conversations.indexes = [
    'CREATE INDEX idx_ai_conversations_account ON ai_conversations (account_email, last_message_at)',
  ];
  conversations.listRule = null;
  conversations.viewRule = null;
  conversations.createRule = null;
  conversations.updateRule = null;
  conversations.deleteRule = null;
  app.save(conversations);

  const events = new Collection({ name: 'ai_events', type: 'base' });
  events.fields.add(new TextField({ name: 'account_email' }));
  events.fields.add(new TextField({ name: 'created_by' }));
  events.fields.add(
    new RelationField({
      name: 'conversation',
      collectionId: conversations.id,
      maxSelect: 1,
      cascadeDelete: true,
    })
  );
  events.fields.add(new NumberField({ name: 'seq' }));
  events.fields.add(new TextField({ name: 'type' }));
  events.fields.add(new JSONField({ name: 'payload' }));
  events.fields.add(new TextField({ name: 'tool_name' }));
  events.fields.add(new TextField({ name: 'tool_call_id' }));
  events.fields.add(new TextField({ name: 'status' }));
  events.fields.add(new NumberField({ name: 'duration_ms' }));
  events.fields.add(new AutodateField({ name: 'created', onCreate: true }));
  events.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
  events.indexes = [
    'CREATE INDEX idx_ai_events_conversation_seq ON ai_events (conversation, seq)',
    'CREATE INDEX idx_ai_events_account ON ai_events (account_email)',
  ];
  events.listRule = null;
  events.viewRule = null;
  events.createRule = null;
  events.updateRule = null;
  events.deleteRule = null;
  app.save(events);
}, (app) => {
  for (const name of ['ai_events', 'ai_conversations', 'ai_providers']) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch {
      // Already removed.
    }
  }
});
