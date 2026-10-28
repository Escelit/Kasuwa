/**
 * Test-only hook for injecting QR payloads in automated emulator / CI test suites.
 *
 * In physical production environments, the camera scanner (react-native-vision-camera)
 * reads optical QR codes. In headless CI or cross-emulator test pipelines where pointing
 * two cameras at screens is impractical, this hook provides direct payload injection.
 *
 * Manual two-phone physical camera testing instructions are documented in docs/manual-testing.md.
 */

let injectedQrPayload: string | null = null;

export function __testInjectQrPayload(payload: string): void {
  injectedQrPayload = payload;
}

export function __getTestInjectedQrPayload(): string | null {
  const p = injectedQrPayload;
  injectedQrPayload = null; // consume
  return p;
}

export function __clearTestInjectedQrPayload(): void {
  injectedQrPayload = null;
}
