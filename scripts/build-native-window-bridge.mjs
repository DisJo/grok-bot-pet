import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(projectRoot, "native/window-bridge/window_bridge.mm");
const outputDir = path.join(projectRoot, "build/native");
const output = path.join(outputDir, "window-bridge.node");
const executableRoot = path.resolve(path.dirname(process.execPath), "..");
const configuredRoot = process.env.npm_config_nodedir;
const includeCandidates = [
  configuredRoot && path.join(configuredRoot, "include/node"),
  configuredRoot,
  path.join(executableRoot, "include/node"),
  "/usr/local/include/node",
  "/opt/homebrew/include/node"
].filter(Boolean);
const nodeInclude = includeCandidates.find((candidate) => existsSync(path.join(candidate, "node_api.h")));

if (process.platform !== "darwin") throw new Error("The native window bridge can only be built on macOS.");
if (!nodeInclude) throw new Error(`Unable to find node_api.h. Checked: ${includeCandidates.join(", ")}`);

await mkdir(outputDir, { recursive: true });
const args = [
  "-std=c++17",
  "-fobjc-arc",
  "-mmacosx-version-min=13.0",
  "-bundle",
  "-undefined", "dynamic_lookup",
  "-framework", "Cocoa",
  "-I", nodeInclude,
  "-arch", "arm64",
  "-arch", "x86_64",
  source,
  "-o", output
];
execFileSync("/usr/bin/xcrun", ["--sdk", "macosx", "clang++", ...args], { stdio: "inherit" });

const architectures = execFileSync("/usr/bin/lipo", ["-archs", output], { encoding: "utf8" }).trim().split(/\s+/).sort();
if (architectures.join(" ") !== "arm64 x86_64") {
  throw new Error(`Expected Universal window bridge, got: ${architectures.join(", ")}`);
}
process.stdout.write(`Built ${output}\nArchitectures: ${architectures.join(", ")}\n`);
