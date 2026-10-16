/**
 * Schreibwege einer Ausgabe, die Modulseite und Ausgabeansicht teilen (LLH-1032, design.md D8):
 *
 * - **Nachtragen** über das Formular (`AusgabeDialog`): `nachtragen` ruft
 *   `erfasseVerpflegungsausgabeOfflineFaehig` und läuft deshalb mit `networkMode: 'always'`
 *   (`offline/AGENTS.md`, „Schreiben ohne Netz“). Gesendet: Rückgängig-Toast; vorgemerkt:
 *   Hinweis ohne „Rückgängig“.
 * - **Rückgängig** aus dem Toast: kein Dialog, und die Karte ist oft nicht mehr zu sehen. Der
 *   Grund einer Ablehnung steht deshalb als `ruecknahmeFehler` an einem festen Platz der Seite
 *   (Modulseite: Seitenhinweis; Ausgabeansicht: unter den Sonderkost-Tasten, damit keine
 *   Zähltaste springt), bis zur nächsten Rücknahme (LFH-1077). Aus den Callbacks statt aus
 *   `mutation.error`: der kennt nur den letzten Aufruf.
 * - **Toasts mit festem Schlüssel:** der Rückgängig-Toast ersetzt den vorigen
 *   (`lfh-rueckgaengig`), der Vormerk-Hinweis ebenso ({@link VORGEMERKT_SCHLUESSEL}); bei 20
 *   Bündeln je Mahlzeit stapelt sich nichts (D6).
 *
 * Ausgaben schreiben keinen ETB-Eintrag: invalidiert wird nur die Verpflegung.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useCallback, useState } from 'react';
import { einsatzKeys } from '../api/queryKeys';
import type { AusgabeEingabe, VerpflegungZeitfenster } from '../api/types';
import { nimmAusgabeZurueck } from '../api/verpflegung';
import { useAuth } from '../auth/AuthContext';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseVerpflegungsausgabeOfflineFaehig } from '../offline/schreiben';
import { zitat } from './verpflegungText';

/** Fester Schlüssel des Hinweises „Offline vorgemerkt“: ein zweiter ersetzt den ersten (D6). */
export const VORGEMERKT_SCHLUESSEL = 'lfh-verpflegung-vorgemerkt';

export interface AusgabeNachtragen {
  /** Das Formular „Ausgabe nachtragen“; lehnt bei einem Fehler ab, der Dialog zeigt ihn. */
  nachtragen: (zf: VerpflegungZeitfenster, body: AusgabeEingabe) => Promise<unknown>;
  laeuft: boolean;
  fehler: unknown;
  /** Vor dem Öffnen des Dialogs: alter Fehler weg. */
  zuruecksetzen: () => void;
  /** Rückgängig-Toast für eine gebuchte Ausgabe. */
  zeigeGebucht: (text: string, ausgabeId: number) => void;
  /** Hinweis „Offline vorgemerkt: …“ ohne Rückgängig. */
  zeigeVorgemerkt: (text: string) => void;
  /** Grund einer abgelehnten Rücknahme aus dem Toast; `null` ohne. */
  ruecknahmeFehler: unknown;
}

export function useAusgabeNachtragen(einsatzId: number): AusgabeNachtragen {
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [ruecknahmeFehler, setRuecknahmeFehler] = useState<unknown>(null);

  const invalidiere = useCallback(
    () => void qc.invalidateQueries({ queryKey: einsatzKeys.verpflegung(einsatzId) }),
    [qc, einsatzId],
  );

  const rueckgaengigMut = useMutation({
    mutationFn: (ausgabeId: number) => nimmAusgabeZurueck(einsatzId, ausgabeId),
    onMutate: () => setRuecknahmeFehler(null),
    onSuccess: () => {
      invalidiere();
      message.success('Ausgabe zurückgenommen');
    },
    onError: (e) => {
      setRuecknahmeFehler(e);
      invalidiere();
    },
  });
  const nimmZurueck = rueckgaengigMut.mutate;

  const zeigeGebucht = useCallback(
    (text: string, ausgabeId: number) =>
      zeigeRueckgaengig(message, text, () => nimmZurueck(ausgabeId)),
    [message, nimmZurueck],
  );
  const zeigeVorgemerkt = useCallback(
    (text: string) => {
      message.open({ key: VORGEMERKT_SCHLUESSEL, type: 'warning', content: text });
    },
    [message],
  );

  const ausgabeMut = useMutation({
    networkMode: 'always',
    mutationFn: ({ zf, body }: { zf: VerpflegungZeitfenster; body: AusgabeEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseVerpflegungsausgabeOfflineFaehig(benutzer.id, einsatzId, zf, body);
    },
    onSuccess: (ergebnis, { zf, body }) => {
      // Vorgemerkt gibt es noch keine Ausgabe auf dem Server — also kein „Rückgängig“.
      if (ergebnis.zustand === 'vorgemerkt') {
        zeigeVorgemerkt(`Offline vorgemerkt: ${body.menge} EP zu ${zitat(zf.bezeichnung)}`);
        return;
      }
      invalidiere();
      zeigeGebucht(
        `Ausgabe nachgetragen: ${body.menge} EP zu ${zitat(zf.bezeichnung)}`,
        ergebnis.daten.ausgabe_id,
      );
    },
  });

  return {
    nachtragen: (zf, body) => ausgabeMut.mutateAsync({ zf, body }),
    laeuft: ausgabeMut.isPending,
    fehler: ausgabeMut.error,
    zuruecksetzen: ausgabeMut.reset,
    zeigeGebucht,
    zeigeVorgemerkt,
    ruecknahmeFehler,
  };
}
