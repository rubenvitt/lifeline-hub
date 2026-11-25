/**
 * Text für XML 1.0 (KML- und GPX-Schreiber des Lagekarten-Exports): unzulässige Steuerzeichen
 * entfallen, die fünf vordefinierten Entitäten werden escaped (für Element- und Attributwerte).
 */

// eslint-disable-next-line no-control-regex -- in XML 1.0 unzulässige Steuerzeichen
const UNZULAESSIG = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function escapeXml(text: string): string {
  return text
    .replace(UNZULAESSIG, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
