export function isInternalDataDiagnosticsEnabled(): boolean {
  return process.env.SHOW_INTERNAL_DATA_DIAGNOSTICS === "true";
}
