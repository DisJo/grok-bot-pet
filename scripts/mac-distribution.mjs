export function requireDeveloperIdSignature(details) {
  const identity = details.match(/^Authority=(Developer ID Application:.+)$/m)?.[1]?.trim();
  const teamIdentifier = details.match(/^TeamIdentifier=(\S+)$/m)?.[1];
  if (!identity || !teamIdentifier || teamIdentifier === "not set" || /Signature=adhoc/.test(details)) {
    throw new Error("Application must be signed with a valid Developer ID Application identity.");
  }
  return { identity, teamIdentifier };
}

export function machOPathsFromFileOutput(output) {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^(.*?):\s+Mach-O\b/);
    if (!match || match[1].includes(" (for architecture ")) return [];
    return [match[1]];
  });
}

export function mountOutputContainsPath(output, mountPath) {
  const aliases = [mountPath];
  if (mountPath.startsWith("/var/") || mountPath.startsWith("/tmp/")) aliases.push(`/private${mountPath}`);
  return output.split("\n").some((line) => aliases.some((candidate) => line.includes(` on ${candidate} (`)));
}

export function requireUniversalArchitectures(label, architectures) {
  const normalized = [...architectures].sort();
  if (normalized.join(" ") !== "arm64 x86_64") {
    throw new Error(`${label} must be Universal, got: ${normalized.join(" ")}`);
  }
  return normalized;
}

export function notarytoolSubmitArgs(artifactPath, keychainProfile, timeout) {
  return [
    "notarytool",
    "submit",
    artifactPath,
    "--keychain-profile",
    keychainProfile,
    "--wait",
    "--timeout",
    timeout
  ];
}
