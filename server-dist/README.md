# Bundled server placeholder

`npm run build:desktop` fills this directory with the Next standalone server
(`server.js`, traced `node_modules`, `.next/static`, and `public`). The Tauri
bundle ships it as `server/`, and the Rust supervisor starts `server/server.js`
on loopback port 3210.

The committed README is deliberate: the directory must exist for `cargo check`
and for the bundle manifest to validate, even before a desktop build has run.
Do not commit generated server output.
