import { Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { loadStammdatenHerkunft } from '../api/instanz';
import { globalKeys } from '../api/queryKeys';
import type { StammdatenArt, StammdatenHerkunftAnzeige } from '../api/types';

/**
 * Herkunft der Stammdaten (LLH-1493, Spec `stammdaten-verteilung`, design.md D9): bezieht die Org
 * dieser Instanz ihre Stammdaten aus einer Kopplung, trägt jede Zeile „vom Hub“ (nur lesbar) oder
 * „nur hier“ (Ergänzung vor Ort). Ohne Quelle gibt es keins von beiden, und nichts ist gesperrt.
 *
 * Der Server sperrt ohnehin (409 „Wird am Hub gepflegt.“); die Oberfläche sagt es vorher, damit
 * niemand erst nach dem Ausfüllen eines Dialogs davon erfährt.
 */

/** Grund der Sperre, wörtlich wie die 409 des Servers. */
export const VOM_HUB_TEXT = 'Wird am Hub gepflegt';

export type Herkunft = 'vom_hub' | 'nur_hier';

/** Rein, für den Test exportiert. */
export function herkunftVon(
  anzeige: StammdatenHerkunftAnzeige | undefined,
  art: StammdatenArt,
  schluessel: string | number,
): Herkunft | null {
  if (!anzeige?.quelle) return null;
  return anzeige.vom_hub[art]?.includes(String(schluessel)) ? 'vom_hub' : 'nur_hier';
}

export interface StammdatenHerkunft {
  quelle?: string;
  /** Am verteilenden Hub, nur für Admins: System-Admins ohne Anmelde-Passkey (D7). */
  ohnePasskey: (kontoId: number) => boolean;
  herkunft: (art: StammdatenArt, schluessel: string | number) => Herkunft | null;
  istVomHub: (art: StammdatenArt, schluessel: string | number) => boolean;
}

/** Herkunft der Stammdaten der eigenen Org; ohne Antwort (Ladezeit, Fehler) ist nichts gesperrt. */
export function useStammdatenHerkunft(): StammdatenHerkunft {
  const q = useQuery({
    queryKey: globalKeys.stammdatenHerkunft(),
    queryFn: loadStammdatenHerkunft,
    staleTime: 60_000,
  });
  const herkunft = (art: StammdatenArt, schluessel: string | number) =>
    herkunftVon(q.data, art, schluessel);
  return {
    quelle: q.data?.quelle ?? undefined,
    ohnePasskey: (kontoId) => q.data?.admins_ohne_passkey.includes(kontoId) ?? false,
    herkunft,
    istVomHub: (art, schluessel) => herkunft(art, schluessel) === 'vom_hub',
  };
}

/**
 * Abzeichen „vom Hub“ / „nur hier“ neben der Kennung einer Zeile. Neutrales `Tag` wie `DemoMarke`:
 * der Text trägt die Bedeutung, kein Status, keine Farbe.
 */
export function HerkunftAbzeichen({
  herkunft,
  quelle,
}: {
  herkunft: Herkunft | null;
  quelle?: string;
}) {
  if (!herkunft) return null;
  return herkunft === 'vom_hub' ? (
    <Tag title={`Kommt aus ${quelle ?? 'der Kopplung'} und wird dort gepflegt`}>vom Hub</Tag>
  ) : (
    <Tag title="Hier ergänzt, nicht am Hub">nur hier</Tag>
  );
}

/** Hinweis an einem Admin ohne Passkey an der Instanz, die die Geheimnisse verteilt (Spec). */
export const PASSKEY_FUER_ELW_TEXT = 'Für die Anmeldung am ELW zuerst einen Passkey einrichten';

/** Statt der Aktionsknöpfe einer Zeile „vom Hub“: der Grund in Worten. */
export function VomHubGesperrt() {
  return <Typography.Text type="secondary">{VOM_HUB_TEXT}</Typography.Text>;
}
