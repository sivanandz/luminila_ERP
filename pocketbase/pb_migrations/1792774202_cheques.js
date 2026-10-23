/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — not applied. Review before running.
 *
 * Cheques currently live as a JSON array in `store_settings` under
 * `cheque_register`. This collection gives the register a real ledger with the
 * lifecycle the engine already enforces.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "cheques",
    listRule: '@request.auth.email != "" && account_email = @request.auth.email',
    viewRule: '@request.auth.email != "" && account_email = @request.auth.email',
    createRule: '@request.auth.email != "" && account_email = @request.auth.email',
    updateRule: '@request.auth.email != "" && account_email = @request.auth.email',
    deleteRule: '@request.auth.email != "" && account_email = @request.auth.email',
    fields: [
      { name: "account_email", type: "text", required: true, max: 255 },
      { name: "cheque_number", type: "text", required: true, max: 6, min: 6, pattern: "^[0-9]{6}$" },
      { name: "direction", type: "select", required: true, maxSelect: 1, values: ["received", "issued"] },
      { name: "party_name", type: "text", required: true, max: 200 },
      { name: "bank_name", type: "text", required: true, max: 120 },
      { name: "branch_name", type: "text", max: 120 },
      { name: "cheque_date", type: "date", required: true },
      { name: "amount", type: "number", required: true, min: 0 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "deposited", "cleared", "bounced", "cancelled"] },
      { name: "deposit_date", type: "date" },
      { name: "clearing_date", type: "date" },
      { name: "target_bank_account", type: "text", max: 120 },
      { name: "bounce_reason", type: "text", max: 300 },
      { name: "bounce_penalty", type: "number", min: 0 },
      { name: "notes", type: "text", max: 2000 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_cheques_tenant_number ON cheques (account_email, bank_name, cheque_number)",
      "CREATE INDEX idx_cheques_status ON cheques (account_email, status, cheque_date)",
    ],
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("cheques");
  app.delete(collection);
});
