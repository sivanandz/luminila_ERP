/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const rule = "@request.auth.id != ''"

  // 1. roles
  try {
    const roles = app.findCollectionByNameOrId("pbc_2105053228")
    unmarshal({
      "createRule": rule,
      "deleteRule": rule,
      "listRule": rule,
      "updateRule": rule,
      "viewRule": rule
    }, roles)
    app.save(roles)
  } catch (e) {
    console.log("Migration warning for roles:", e)
  }

  // 2. user_roles
  try {
    const userRoles = app.findCollectionByNameOrId("pbc_2857166095")
    unmarshal({
      "createRule": rule,
      "deleteRule": rule,
      "listRule": rule,
      "updateRule": rule,
      "viewRule": rule
    }, userRoles)
    app.save(userRoles)
  } catch (e) {
    console.log("Migration warning for user_roles:", e)
  }

  // 3. number_sequences
  try {
    const numberSequences = app.findCollectionByNameOrId("pbc_2215506785")
    unmarshal({
      "createRule": rule,
      "deleteRule": rule,
      "listRule": rule,
      "updateRule": rule,
      "viewRule": rule
    }, numberSequences)
    app.save(numberSequences)
  } catch (e) {
    console.log("Migration warning for number_sequences:", e)
  }

  // 4. store_settings
  try {
    const storeSettings = app.findCollectionByNameOrId("pbc_4242123432")
    unmarshal({
      "createRule": rule,
      "deleteRule": rule,
      "listRule": rule,
      "updateRule": rule,
      "viewRule": rule
    }, storeSettings)
    app.save(storeSettings)
  } catch (e) {
    console.log("Migration warning for store_settings:", e)
  }
}, (app) => {
  // rollback logic
})
