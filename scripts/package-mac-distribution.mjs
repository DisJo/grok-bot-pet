import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  machOPathsFromFileOutput,
  mountOutputContainsPath,
  notarytoolSubmitArgs,
  requireDeveloperIdSignature,
  requireUniversalArchitectures
} from "./mac-distribution.mjs";

const projectRoot = process.cwd();
const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const releaseDir = path.join(projectRoot, "release");
const appPath = path.join(releaseDir, "mac-universal", `${pkg.build.productName}.app`);
const distributionDir = path.join(releaseDir, "distribution");
const pendingDistributionDir = path.join(releaseDir, `.distribution-${process.pid}.pending`);
const previousDistributionDir = path.join(releaseDir, `.distribution-${process.pid}.previous`);
const baseName = `Grok-Bot-Pet-${pkg.version}-mac-universal`;
const zipPath = path.join(pendingDistributionDir, `${baseName}.zip`);
const dmgPath = path.join(pendingDistributionDir, `${baseName}.dmg`);
const stageDir = path.join(pendingDistributionDir, ".dmg-stage");
const extractedDir = path.join(pendingDistributionDir, ".verify-zip");
const appNotaryZipPath = path.join(pendingDistributionDir, ".notary-app.zip");
const installGuidePath = path.join(pendingDistributionDir, "安装说明.txt");
const appExecutablePath = path.join(appPath, "Contents", "MacOS", pkg.build.productName);
const nativeBridgePath = path.join(appPath, "Contents", "Resources", "native", "window-bridge.node");
const notaryProfile = process.env.NOTARYTOOL_PROFILE?.trim() || "grok-bot-pet-notary";
const notaryTimeout = process.env.NOTARYTOOL_TIMEOUT?.trim() || "30m";

function run(command, args, options = {}) {
  if (options.capture) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
    return `${result.stdout || ""}${result.stderr || ""}`;
  }
  return execFileSync(command, args, { encoding: "utf8", stdio: "inherit" });
}

function tryRun(command, args) {
  return spawnSync(command, args, { encoding: "utf8" }).status === 0;
}

function detachDiskImage(mountPath) {
  const mounts = run("/sbin/mount", [], { capture: true });
  if (!mountOutputContainsPath(mounts, mountPath)) return;
  if (!tryRun("/usr/bin/hdiutil", ["detach", mountPath])) {
    run("/usr/bin/hdiutil", ["detach", "-force", mountPath]);
  }
}

function assertUniversalBinary(label, binaryPath) {
  const architectures = run("/usr/bin/lipo", ["-archs", binaryPath], { capture: true }).trim().split(/\s+/);
  return requireUniversalArchitectures(label, architectures);
}

function assertUniversalBundle(label, bundlePath) {
  const listing = run("/usr/bin/find", [bundlePath, "-type", "f", "-exec", "/usr/bin/file", "{}", "+"], { capture: true });
  const binaries = machOPathsFromFileOutput(listing);
  if (!binaries.length) throw new Error(`${label} contains no Mach-O binaries.`);
  for (const binaryPath of binaries) assertUniversalBinary(path.relative(bundlePath, binaryPath), binaryPath);
  return binaries.length;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function publishDistribution() {
  const hadPreviousDistribution = await pathExists(distributionDir);
  if (hadPreviousDistribution) await rename(distributionDir, previousDistributionDir);
  try {
    await rename(pendingDistributionDir, distributionDir);
  } catch (error) {
    if (hadPreviousDistribution) await rename(previousDistributionDir, distributionDir);
    throw error;
  }
  await rm(previousDistributionDir, { recursive: true, force: true });
}

let signature;
let architectures;
let machOBinaryCount;
let dmgMountDir;

await mkdir(pendingDistributionDir, { recursive: true });

try {
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  signature = requireDeveloperIdSignature(run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], { capture: true }));
  architectures = assertUniversalBinary("Application executable", appExecutablePath);
  assertUniversalBinary("Native window bridge", nativeBridgePath);
  machOBinaryCount = assertUniversalBundle("Application", appPath);

  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, appNotaryZipPath]);
  run("/usr/bin/xcrun", notarytoolSubmitArgs(appNotaryZipPath, notaryProfile, notaryTimeout));
  run("/usr/bin/xcrun", ["stapler", "staple", appPath]);
  run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
  await rm(appNotaryZipPath, { force: true });

  const guide = `Grok Bot Pet ${pkg.version} 安装说明

支持：macOS 13 或更高版本，Apple Silicon 与 Intel Mac。

DMG 安装：
1. 打开 ${baseName}.dmg。
2. 将 Grok Bot Pet 拖入 Applications（应用程序）。
3. 在“应用程序”中双击 Grok Bot Pet 启动。

ZIP 安装：
1. 使用 macOS 自带的归档实用工具解压 ${baseName}.zip。
2. 将 Grok Bot Pet.app 拖入“应用程序”。
3. 双击 Grok Bot Pet 启动。

说明：此安装包已经过 Apple Developer ID 签名和 Apple 公证。macOS 首次启动时仍可能显示标准的“从互联网下载”确认提示。不要直接通过聊天软件传输裸 .app，请发送完整 ZIP 或 DMG 文件。
`;
  await writeFile(installGuidePath, guide, "utf8");

  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);

  await mkdir(stageDir, { recursive: true });
  run("/usr/bin/ditto", [appPath, path.join(stageDir, `${pkg.build.productName}.app`)]);
  await cp(installGuidePath, path.join(stageDir, "安装说明.txt"));
  await symlink("/Applications", path.join(stageDir, "Applications"));
  run("/usr/bin/hdiutil", ["create", "-volname", pkg.build.productName, "-srcfolder", stageDir, "-ov", "-format", "UDZO", dmgPath]);
  run("/usr/bin/codesign", ["--force", "--sign", signature.identity, "--timestamp", dmgPath]);
  run("/usr/bin/codesign", ["--verify", "--verbose=2", dmgPath]);
  run("/usr/bin/xcrun", notarytoolSubmitArgs(dmgPath, notaryProfile, notaryTimeout));
  run("/usr/bin/xcrun", ["stapler", "staple", dmgPath]);
  run("/usr/bin/xcrun", ["stapler", "validate", dmgPath]);
  run("/usr/bin/codesign", ["--verify", "--verbose=2", dmgPath]);
  run("/usr/sbin/spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmgPath]);
  run("/usr/bin/hdiutil", ["verify", dmgPath]);

  dmgMountDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "grok-bot-pet-dmg-mount-")));
  run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", dmgMountDir, dmgPath]);
  try {
    const mountedApp = path.join(dmgMountDir, `${pkg.build.productName}.app`);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", mountedApp]);
    run("/usr/bin/xcrun", ["stapler", "validate", mountedApp]);
    run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", mountedApp]);
    const mountedMachOBinaryCount = assertUniversalBundle("DMG application", mountedApp);
    if (mountedMachOBinaryCount !== machOBinaryCount) {
      throw new Error(`DMG changed the Mach-O binary count: expected ${machOBinaryCount}, got ${mountedMachOBinaryCount}`);
    }
  } finally {
    detachDiskImage(dmgMountDir);
  }

  await mkdir(extractedDir, { recursive: true });
  run("/usr/bin/ditto", ["-x", "-k", zipPath, extractedDir]);
  const extractedApp = path.join(extractedDir, `${pkg.build.productName}.app`);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", extractedApp]);
  run("/usr/bin/xcrun", ["stapler", "validate", extractedApp]);
  run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", extractedApp]);
  const extractedMachOBinaryCount = assertUniversalBundle("Extracted application", extractedApp);
  if (extractedMachOBinaryCount !== machOBinaryCount) {
    throw new Error(`ZIP changed the Mach-O binary count: expected ${machOBinaryCount}, got ${extractedMachOBinaryCount}`);
  }
  const extractedExecutablePath = path.join(extractedApp, "Contents", "MacOS", pkg.build.productName);
  const executableMode = run("/usr/bin/stat", ["-f", "%A", extractedExecutablePath], { capture: true }).trim();
  if (!/[1357]$/.test(executableMode)) throw new Error(`Executable permission was not preserved: ${executableMode}`);

  const hashes = [zipPath, dmgPath].map((artifact) => {
    const digest = run("/usr/bin/shasum", ["-a", "256", artifact], { capture: true }).trim().split(/\s+/)[0];
    return `${digest}  ${path.basename(artifact)}`;
  }).join("\n") + "\n";
  await writeFile(path.join(pendingDistributionDir, "SHA256SUMS.txt"), hashes, "utf8");

  await rm(stageDir, { recursive: true, force: true });
  await rm(extractedDir, { recursive: true, force: true });
  await rm(dmgMountDir, { recursive: true, force: true });
  await publishDistribution();
} finally {
  if (dmgMountDir) {
    detachDiskImage(dmgMountDir);
    await rm(dmgMountDir, { recursive: true, force: true });
  }
  await rm(pendingDistributionDir, { recursive: true, force: true });
  if (await pathExists(previousDistributionDir)) {
    if (!(await pathExists(distributionDir))) await rename(previousDistributionDir, distributionDir);
    else await rm(previousDistributionDir, { recursive: true, force: true });
  }
}

process.stdout.write(`\nDistribution artifacts verified:\n${path.join(distributionDir, path.basename(zipPath))}\n${path.join(distributionDir, path.basename(dmgPath))}\nArchitectures: ${architectures.join(", ")} (${machOBinaryCount} Mach-O binaries)\nSignature: ${signature.identity}\nTeam: ${signature.teamIdentifier}\nNotarization: stapled and accepted by Gatekeeper\n`);
