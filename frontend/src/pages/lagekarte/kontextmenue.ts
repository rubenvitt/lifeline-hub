/**
 * Einträge des Kontextmenüs an der Kartenstelle (LFH-776, Spec `lagekarte-kontextmenue`,
 * `openspec/changes/lfh-776-lagekarte-kontextmenue/design.md` D4). Rein, ohne Karte prüfbar.
 *
 * Der Rechte-Riegel sitzt HIER, an der Ableitung (`frontend/AGENTS.md`, „Aktionen“): ohne
 * Schreibrecht (auch im Snapshot) fehlt „Hier Zeichen setzen“, statt gesperrt zu stehen. Die
 * antd-Items baut `menueEintraege()` aus dem Baustein der gebündelten Aktionen (LFH-365).
 */
import { menueEintraege, type MenueEintrag } from '../../components/MenueAusloeser';

export type KontextAktion = 'kopieren' | 'messen' | 'zeichen';

export function kontextEintraege({
  darfSchreiben,
}: {
  darfSchreiben: boolean;
}): MenueEintrag<KontextAktion>[] {
  return [
    { key: 'kopieren', label: 'Koordinate kopieren' },
    { key: 'messen', label: 'Messen ab hier' },
    ...(darfSchreiben ? [{ key: 'zeichen' as const, label: 'Hier Zeichen setzen' }] : []),
  ];
}

export function kontextMenueItems(eintraege: readonly MenueEintrag<KontextAktion>[]) {
  return menueEintraege(eintraege) ?? [];
}

/**
 * „Koordinate kopieren“ (D5): Erfolg quittiert, jeder Fehlschlag — keine Zwischenablage (kein Secure
 * Context) oder Ablehnung — nennt die Koordinate selbst, damit sie sich vom Schirm ablesen lässt.
 */
export async function kopiereKoordinate(
  text: string,
  ablage: Pick<Clipboard, 'writeText'> | undefined,
  meldung: { success: (t: string) => unknown; error: (t: string) => unknown },
): Promise<void> {
  try {
    if (typeof ablage?.writeText !== 'function') throw new Error('keine Zwischenablage');
    await ablage.writeText(text);
    meldung.success('Koordinate kopiert');
  } catch {
    meldung.error(`Kopieren nicht möglich: ${text}`);
  }
}
