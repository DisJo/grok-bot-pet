import { describe, expect, it } from "vitest";

import {
  machOPathsFromFileOutput,
  mountOutputContainsPath,
  notarytoolSubmitArgs,
  requireDeveloperIdSignature,
  requireUniversalArchitectures
} from "./mac-distribution.mjs";

describe("macOS distribution signing", () => {
  it("rejects an ad-hoc signature even when codesign verification succeeds", () => {
    expect(() => requireDeveloperIdSignature([
      "Executable=/Applications/Grok Bot Pet.app/Contents/MacOS/Grok Bot Pet",
      "Signature=adhoc",
      "TeamIdentifier=not set"
    ].join("\n"))).toThrow(/Developer ID Application/);
  });

  it("returns the Developer ID identity and team from a valid signature", () => {
    const signature = requireDeveloperIdSignature([
      "Authority=Developer ID Application: Example Developer (ABCDEFGHIJ)",
      "Authority=Developer ID Certification Authority",
      "Authority=Apple Root CA",
      "TeamIdentifier=ABCDEFGHIJ"
    ].join("\n"));

    expect(signature).toEqual({
      identity: "Developer ID Application: Example Developer (ABCDEFGHIJ)",
      teamIdentifier: "ABCDEFGHIJ"
    });
  });

  it("submits artifacts with the configured keychain profile and waits for a result", () => {
    expect(notarytoolSubmitArgs("/tmp/Grok Bot Pet.dmg", "grok-bot-pet-notary", "30m")).toEqual([
      "notarytool",
      "submit",
      "/tmp/Grok Bot Pet.dmg",
      "--keychain-profile",
      "grok-bot-pet-notary",
      "--wait",
      "--timeout",
      "30m"
    ]);
  });

  it("finds every Mach-O path while ignoring resources", () => {
    const output = [
      "/tmp/Grok Bot Pet.app/Contents/MacOS/Grok Bot Pet:             Mach-O universal binary with 2 architectures",
      "/tmp/Grok Bot Pet.app/Contents/MacOS/Grok Bot Pet (for architecture x86_64): Mach-O 64-bit executable x86_64",
      "/tmp/Grok Bot Pet.app/Contents/MacOS/Grok Bot Pet (for architecture arm64): Mach-O 64-bit executable arm64",
      "/tmp/Grok Bot Pet.app/Contents/Resources/icon.icns: Mac OS X icon",
      "/tmp/Grok Bot Pet.app/Contents/Resources/native/window-bridge.node:  Mach-O 64-bit bundle arm64"
    ].join("\n");

    expect(machOPathsFromFileOutput(output)).toEqual([
      "/tmp/Grok Bot Pet.app/Contents/MacOS/Grok Bot Pet",
      "/tmp/Grok Bot Pet.app/Contents/Resources/native/window-bridge.node"
    ]);
  });

  it("rejects a thin Mach-O architecture list", () => {
    expect(() => requireUniversalArchitectures("Native bridge", ["arm64"])).toThrow(/Universal/);
    expect(requireUniversalArchitectures("Native bridge", ["x86_64", "arm64"])).toEqual(["arm64", "x86_64"]);
  });

  it("recognizes an exact mounted DMG path", () => {
    const output = [
      "/dev/disk3s1 on / (apfs, sealed, local, read-only)",
      "/dev/disk7s1 on /private/var/folders/example/grok-bot-pet-dmg-123 (apfs, local, nodev, nosuid, read-only)"
    ].join("\n");

    expect(mountOutputContainsPath(output, "/var/folders/example/grok-bot-pet-dmg-123")).toBe(true);
    expect(mountOutputContainsPath(output, "/var/folders/example/grok-bot-pet-dmg-12")).toBe(false);
  });
});
