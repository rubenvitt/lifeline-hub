import type { MessageInstance } from 'antd/es/message/interface';

/**
 * Erfolgs-Quittung der Sofort-Speichern-Zeilen von `ModulEinstellungsListe` (LFH-478).
 *
 * Gruppierung und Filterfeld machen das Serienschalten bequem; fünf Zeilen im Sekundentakt
 * hinterließen fünf gestapelte Toasts. Bauform wie `kommunikation/rueckgaengig.tsx`: ein fester
 * Schlüssel, die nächste Quittung ERSETZT die stehende. Eigener Schlüssel, damit eine Quittung
 * nie einen offenen Rückweg verdrängt.
 */
const SCHLUESSEL = 'lfh-modul-gespeichert';

export function quittiereModulGespeichert(api: MessageInstance, text: string) {
  api.success({ key: SCHLUESSEL, content: text });
}
