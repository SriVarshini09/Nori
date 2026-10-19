// Launches Electron on this folder with ELECTRON_RUN_AS_NODE unset (some shells and IDEs set it,
// which makes electron behave as plain Node and crash on `require("electron")`).
const { spawn } = require("node:child_process");
const path = require("node:path");

const electronPath = require("electron"); // resolves to the electron binary
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, ".."), ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
