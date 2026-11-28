import type { QueryClient } from '@tanstack/react-query';
import type { FormRule } from 'antd';
import { pflicht } from '../../components/pflichtRegel';
import type { AdapterEinstellungen } from '../../api/adapter';
import { globalKeys } from '../../api/queryKeys';
import type {
  AdapterAnzeige,
  AdapterArtAnzeige,
  AdapterFeld,
  AdapterListe,
  AdapterZustand,
  GeheimnisspeicherZustand,
} from '../../api/types';
import { anbindungenPath } from './anbindungAnzeige';

// Gemeinsames der Adapter-Seiten (LLH-2018): Paneel „Adapter“ auf den Anbindungen und Ansicht.

/** Die Ansicht eines Adapters, unter den Anbindungen. */
export function adapterPath(id: string): string {
  return `${anbindungenPath()}/adapter/${encodeURIComponent(id)}`;
}

type Ton = 'normal' | 'bedien' | 'neutral' | 'achtung';

const ZUSTAND: Record<AdapterZustand, { wort: string; ton: Ton }> = {
  ok: { wort: 'ok', ton: 'normal' },
  wartet: { wort: 'noch nie abgerufen', ton: 'neutral' },
  gestoert: { wort: 'gestört', ton: 'bedien' },
  braucht_eingriff: { wort: 'braucht Eingriff', ton: 'achtung' },
  aus: { wort: 'aus', ton: 'neutral' },
  art_unbekannt: { wort: 'Art unbekannt', ton: 'achtung' },
};

/**
 * Ob die Art nur versendet (SMTP, Matrix, Fax): ihr Lauf prüft im festen Takt nur die
 * Verbindung, sie ruft nichts ab (LLH-2126). Eine unbekannte Art gilt als Abruf.
 */
export function isVersandArt(art: Pick<AdapterArtAnzeige, 'zweck'> | undefined): boolean {
  return art?.zweck === 'versand';
}

/**
 * Wort und Ton des Zustands (Entwurf `docs/design/2026-11-22-adapter/`). Eine Versand-Anbindung
 * ist vor ihrer ersten Prüfung „noch nicht geprüft“ (LLH-2126).
 */
export function adapterZustandAnzeige(
  a: Pick<AdapterAnzeige, 'zustand'>,
  versand = false,
): {
  wort: string;
  ton: Ton;
} {
  if (versand && a.zustand === 'wartet') return { ...ZUSTAND.wartet, wort: 'noch nicht geprüft' };
  return ZUSTAND[a.zustand];
}

/** In der Liste steht der Status nur, wenn er etwas verlangt; „ok“ und „wartet“ nicht. */
export function isZustandSichtbar(z: AdapterZustand): boolean {
  return z !== 'ok' && z !== 'wartet';
}

/**
 * Hinweis zum Geheimnisspeicher; `null`, wenn er bereit ist. Fehlt der Schlüssel, lässt sich
 * nichts setzen; passt er nicht, ist Neusetzen der Weg (Design-Doc, Nachtrag „Speicher“).
 */
export function speicherHinweisText(speicher: GeheimnisspeicherZustand): string | null {
  switch (speicher) {
    case 'fehlt':
      return 'Schlüssel fehlt: Geheimnisse lassen sich nicht setzen, Adapter mit Geheimnis rufen nicht ab. Der Betrieb richtet LIFELINE_GEHEIMNIS_SCHLUESSEL ein.';
    case 'passt_nicht':
      return 'Schlüssel passt nicht: mindestens ein Geheimnis ist mit einem anderen Schlüssel gesetzt und unlesbar. Es muss neu gesetzt werden.';
    case 'bereit':
      return null;
  }
}

/**
 * Hinweis zur Verifizierung beim Matrix-Konto (LLH-2094, Spec 8): der Bot ist ein eigenes Gerät.
 * Der Prüfbefund mit der Geräte-ID steht nicht auf dem Draht, deshalb nur der Text.
 */
export const MATRIX_VERIFIZIERUNG_HINWEIS =
  'Der Versand läuft über ein eigenes Gerät dieses Kontos. In verschlüsselten Räumen zeigt der Client der Empfänger es als nicht verifiziert, bis es in der Geräteliste des Kontos bestätigt ist; die Nachricht kommt trotzdem an.';

/** Setzt die Antwort einer eigenen Änderung in die Liste und lässt sie danach neu laden. */
export function uebernimmAdapter(qc: QueryClient, a: AdapterAnzeige): void {
  qc.setQueryData<AdapterListe>(globalKeys.adapter(), (alt) =>
    alt
      ? {
          ...alt,
          adapter: alt.adapter.some((x) => x.id === a.id)
            ? alt.adapter.map((x) => (x.id === a.id ? a : x))
            : [...alt.adapter, a],
        }
      : alt,
  );
  void qc.invalidateQueries({ queryKey: globalKeys.adapter() });
}

/** Nimmt einen gelöschten Adapter aus der Liste. */
export function entferneAdapter(qc: QueryClient, id: string): void {
  qc.setQueryData<AdapterListe>(globalKeys.adapter(), (alt) =>
    alt ? { ...alt, adapter: alt.adapter.filter((x) => x.id !== id) } : alt,
  );
  qc.removeQueries({ queryKey: globalKeys.adapterVersuche(id) });
  void qc.invalidateQueries({ queryKey: globalKeys.adapter() });
}

function hostVon(wert: unknown): string | null {
  if (typeof wert !== 'string' || wert.trim() === '') return null;
  try {
    const host = new URL(wert.trim()).hostname;
    return host ? host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Der Wert eines Host-Felds (Hostname ohne Schema), getrimmt und kleingeschrieben. */
function hostName(wert: unknown): string | null {
  if (typeof wert !== 'string' || wert.trim() === '') return null;
  return wert.trim().toLowerCase();
}

/** Ein URL- oder Host-Feld, dessen Host eine Änderung wechselt. */
export interface HostWechsel {
  feld: string;
  bisher: string | null;
  neu: string;
}

/**
 * Welche URL- und Host-Felder einen neuen Host bekämen; wie `art::has_neues_ziel` im Server: zählt nur, wenn
 * danach ein lesbarer Host dasteht, der vorher nicht dastand. Dann entfernt der Server die
 * Geheimnisse, und die Ansicht fragt vorher.
 */
export function hostWechsel(
  felder: readonly AdapterFeld[],
  vorher: Record<string, unknown>,
  nachher: Record<string, unknown>,
): HostWechsel[] {
  return felder
    .filter((f) => f.typ === 'url' || f.typ === 'host')
    .flatMap((f) => {
      const lies = f.typ === 'host' ? hostName : hostVon;
      const neu = lies(nachher[f.name]);
      const bisher = lies(vorher[f.name]);
      return neu != null && neu !== bisher ? [{ feld: f.bezeichnung, bisher, neu }] : [];
    });
}

/**
 * Formularwerte → Einstellungen der Art: Text getrimmt, Zahlen als Zahl, Leeres fällt weg (der
 * Server nimmt ein fehlendes Feld als leer).
 */
export function einstellungenVon(
  felder: readonly AdapterFeld[],
  werte: Record<string, unknown>,
): AdapterEinstellungen {
  const aus: AdapterEinstellungen = {};
  for (const f of felder) {
    const roh = werte[f.name];
    if (roh == null) continue;
    if (f.typ === 'zahl') {
      const text = String(roh).trim();
      if (text === '') continue;
      const zahl = Number(text);
      if (Number.isFinite(zahl)) aus[f.name] = zahl;
      continue;
    }
    const text = String(roh).trim();
    if (text !== '') aus[f.name] = text;
  }
  return aus;
}

/** Die Einstellungen einer Antwort als Objekt (der Server liefert sie nur dem System-Admin). */
export function einstellungenVonAdapter(
  a: Pick<AdapterAnzeige, 'einstellungen'>,
): Record<string, unknown> {
  const e = a.einstellungen as unknown;
  return e != null && typeof e === 'object' ? (e as Record<string, unknown>) : {};
}

/**
 * Prüfregeln eines Einstellungsfelds der Art, wie der Server sie anwendet (`art::check_einstellungen`):
 * Pflicht, Höchstlänge, eine Adresse nur mit https. Anlegen und Bearbeiten teilen sie.
 */
export function einstellungsRegeln(feld: AdapterFeld, httpImLan = false): FormRule[] {
  // Erlaubt eine Art `http` im LAN (ADR-0105), prüft der Server Netz und LAN-Ausnahme.
  const url = httpImLan
    ? {
        pattern: /^\s*https?:\/\//i,
        message: `${feld.bezeichnung} beginnt mit https:// oder, im LAN, mit http://`,
      }
    : { pattern: /^\s*https:\/\//i, message: `${feld.bezeichnung} beginnt mit https://` };
  return [
    ...(feld.pflicht ? [pflicht(feld.bezeichnung, { whitespace: feld.typ !== 'zahl' })] : []),
    ...(feld.max > 0 ? [{ max: feld.max, message: `Höchstens ${feld.max} Zeichen` }] : []),
    ...(feld.typ === 'url' ? [url] : []),
  ];
}
