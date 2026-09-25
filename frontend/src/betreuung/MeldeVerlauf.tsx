import { App, Button, Modal, Skeleton, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ladeBelegungVerlauf,
  ladeStandVerlauf,
  nimmBelegungZurueck,
  nimmStandZurueck,
} from '../api/betreuung';
import { einsatzKeys, type BetreuungVerlaufArt } from '../api/queryKeys';
import type { BelegungVerlaufEintrag, StandVerlaufEintrag } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { formatZeitKurz } from '../anzeige/format';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import Zeitachseneintrag from '../components/instrument/Zeitachseneintrag';
import {
  PANEEL_FEHLER_TITEL,
  PANEEL_FEHLER_TEXT,
  PANEEL_NEULADEN,
} from '../components/instrument/PaneelZustand';
import { useRollen } from '../components/instrument/rollenwerte';
import {
  aktuellWort,
  belegungZeile,
  istNachgetragenMeldung,
  rueckfrageHinweis,
  ruecknahmeName,
  standZeile,
  type VerlaufZeile,
} from './verlauf';

/**
 * Meldeverlauf eines Evakuierungsbezirks bzw. einer Betreuungsstelle (LFH-676, design.md D4–D6).
 *
 * Steht im Aufklappbereich der `Datensicht` und wird erst beim Aufklappen gerendert — die
 * Abfrage läuft deshalb beim Mount und nur für die aufgeklappte Zeile. Der Schlüssel hängt
 * unter dem Betreuungs-Prefix: das Live-Ereignis `betreuung` und jede eigene Mutation der
 * Seite ziehen einen offenen Verlauf mit.
 *
 * DARSTELLUNG: eine Zeitachse aus `Zeitachseneintrag` (ein zeitlich gelesener Strom). Typkante
 * und Typwort sind die des ETB — „Meldung“, zurückgenommen „Berichtigung“-Farbe mit dem Wort
 * „zurückgenommen“ und getönter Zeile. Die aktuelle, nachgetragene und zurückgenommene
 * Meldung trägt je ein WORT (WCAG 1.4.1), nicht nur Farbe.
 *
 * ZUSTÄNDE: Laden, Fehler und leer in Worten; ein Ladefehler ist nie „Noch keine Meldung“.
 * Nicht über `PaneelZustand`: dessen Leerzustand verlangt eine eigene Aktion, und die steht
 * hier schon daneben („Stand melden“ an der Karte, „Belegung melden“ in der Zeile) — eine
 * zweite wäre eine Doppelung. Den Wortlaut des Fehlers teilt der Verlauf mit dem Baustein.
 *
 * RÜCKNAHME (D6): unumkehrbar, es gibt keine Route, die eine Rücknahme aufhebt — deshalb eine
 * Rückfrage (LFH-363) mit rotem Bestätigungsknopf, als `Modal` mit eigenem State außerhalb der
 * Eintrags-`map` (LFH-365). Der Auslöser selbst bleibt neutral (Vorbild Verpflegung).
 * Ein Fehler bleibt IM Dialog (LFH-535), nicht im Toast; die Mutation gehört dem Verlauf und
 * nicht der Seite, damit derselbe Grund nicht zusätzlich über der Seite erscheint.
 */
export default function MeldeVerlauf({
  einsatzId,
  art,
  objektId,
  darfZuruecknehmen,
  sperrHinweis,
}: {
  einsatzId: number;
  art: BetreuungVerlaufArt;
  objektId: number;
  /** Auslöser „Zurücknehmen“ an jeder nicht zurückgenommenen Meldung. */
  darfZuruecknehmen: boolean;
  /**
   * Steht EINMAL über der Reihe, wenn Zurücknehmen gerade nicht geht (geschlossene Stelle).
   * Ohne Schreibrecht bleibt es leer: den Grund nennt der Rechtehinweis über der Seite.
   */
  sperrHinweis?: string;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const abfrage = useQuery<StandVerlaufEintrag[] | BelegungVerlaufEintrag[], Error, VerlaufZeile[]>(
    {
      queryKey: einsatzKeys.betreuungVerlauf(einsatzId, art, objektId),
      queryFn: () =>
        art === 'bezirk'
          ? ladeStandVerlauf(einsatzId, objektId)
          : ladeBelegungVerlauf(einsatzId, objektId),
      select: (r) =>
        art === 'bezirk'
          ? (r as StandVerlaufEintrag[]).map(standZeile)
          : (r as BelegungVerlaufEintrag[]).map(belegungZeile),
    },
  );

  const [ziel, setZiel] = useState<VerlaufZeile | null>(null);
  const wurzel = useRef<HTMLDivElement>(null);
  // Nach einer gelungenen Rücknahme verschwindet der Knopf, der die Rückfrage öffnete; antd
  // gäbe den Fokus an ihn zurück und landete auf <body>. Der Verlauf nimmt ihn stattdessen —
  // als State, weil er `focusTriggerAfterClose` im selben Render abschalten muss.
  const [fokusZurueck, setFokusZurueck] = useState(false);
  // Sofort beim Schließen, nicht erst in `afterClose`: das feuert erst am Ende der
  // Zoom-Animation (in jsdom nie). `afterClose` holt ihn im Browser ein zweites Mal, falls
  // die Animation ihn verschoben hat.
  useEffect(() => {
    if (ziel == null && fokusZurueck) wurzel.current?.focus();
  }, [ziel, fokusZurueck]);
  const invalidiere = () => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  };
  const ruecknahme = useMutation({
    // Die Antwort braucht der Verlauf nicht — er lädt über die Invalidierung neu.
    mutationFn: async (meldungId: number): Promise<void> => {
      if (art === 'bezirk') await nimmStandZurueck(einsatzId, meldungId);
      else await nimmBelegungZurueck(einsatzId, meldungId);
    },
    onSuccess: () => {
      invalidiere();
      setFokusZurueck(true);
      setZiel(null);
      message.success('Meldung zurückgenommen');
    },
    // Kein Toast: der Grund steht im offenen Dialog. Neu laden trotzdem — ein 422 heißt oft,
    // dass die Reihe veraltet ist (von anderer Hand zurückgenommen, Stelle geschlossen).
    onError: invalidiere,
  });
  const oeffne = (z: VerlaufZeile) => {
    // react-query hält `error` bis zum nächsten `mutate()` — ein alter Grund wanderte sonst in
    // eine neue Rückfrage.
    ruecknahme.reset();
    setFokusZurueck(false);
    setZiel(z);
  };

  const polster = { padding: token.paddingSM } as const;
  let koerper;
  if (abfrage.isError) {
    koerper = (
      <div
        role="alert"
        data-lfh="verlauf-fehler"
        style={{ ...polster, display: 'flex', flexDirection: 'column', gap: token.marginXS }}
      >
        <b style={{ color: rollen.alarmText, fontSize: 13 }}>{PANEEL_FEHLER_TITEL}</b>
        <span style={{ color: rollen.gedaempft, fontSize: 12 }}>
          Verlauf konnte nicht geladen werden. {PANEEL_FEHLER_TEXT}
        </span>
        <span>
          <Button onClick={() => void abfrage.refetch()}>{PANEEL_NEULADEN}</Button>
        </span>
      </div>
    );
  } else if (abfrage.isPending) {
    koerper = (
      <div aria-busy="true" style={polster}>
        {/* Der Zustand in WORTEN (Spec): ein Skelett allein sagt Sehenden wie Vorlesenden
            nichts, und ein `aria-label` an einem rollenlosen `div` wird nicht vorgelesen. */}
        <Typography.Text type="secondary">Verlauf wird geladen …</Typography.Text>
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      </div>
    );
  } else if (abfrage.data.length === 0) {
    koerper = (
      <Typography.Text type="secondary" style={{ ...polster, display: 'block' }}>
        Noch keine Meldung.
      </Typography.Text>
    );
  } else {
    koerper = (
      <ol style={{ margin: 0, padding: 0 }}>
        {abfrage.data.map((z) => {
          const zurueck = z.zurueckgenommen_at != null;
          const hinweise = [
            istNachgetragenMeldung(z) && (
              <span key="nachtrag">
                <span aria-hidden="true">⧖ </span>nachgetragen um{' '}
                <ZeitAnzeige wert={z.erfasst_at} format="kurz" />
              </span>
            ),
            zurueck && (
              <span key="zurueck">
                zurückgenommen <ZeitAnzeige wert={z.zurueckgenommen_at} format="kurz" />
                {z.zurueckgenommen_von ? ` von ${z.zurueckgenommen_von}` : ''}
              </span>
            ),
          ].filter(Boolean);
          return (
            <Zeitachseneintrag
              key={z.id}
              als="li"
              data-lfh="verlauf-eintrag"
              zeit={<ZeitAnzeige wert={z.zeitpunkt_at} format="kurz" />}
              typ={zurueck ? 'berichtigung' : 'meldung'}
              typwort={zurueck ? 'zurückgenommen' : 'Meldung'}
              meta={z.aktuell ? aktuellWort(art) : undefined}
              toenung={zurueck ? 'berichtigung' : undefined}
              hinweis={
                hinweise.length > 0 ? (
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: 12 }}>
                    {hinweise}
                  </span>
                ) : undefined
              }
              verfasser={z.erfasst_von}
              aktionen={
                darfZuruecknehmen && !zurueck ? (
                  // Neutral wie „Zurücknehmen“ an der Ausgabenzeile der Verpflegung (LFH-634):
                  // rot ist erst der Bestätigungsknopf der Rückfrage — drei rote Knöpfe
                  // untereinander machten aus einer Liste eine Alarmfläche.
                  <Button
                    aria-label={ruecknahmeName(z, formatZeitKurz(z.zeitpunkt_at, konventionen))}
                    onClick={() => oeffne(z)}
                  >
                    Zurücknehmen
                  </Button>
                ) : undefined
              }
            >
              {z.text}
            </Zeitachseneintrag>
          );
        })}
      </ol>
    );
  }

  return (
    <div data-lfh="melde-verlauf" ref={wurzel} tabIndex={-1} style={{ outline: 'none' }}>
      {sperrHinweis && (
        <Typography.Text
          type="secondary"
          data-lfh="verlauf-sperre"
          style={{ ...polster, display: 'block' }}
        >
          {sperrHinweis}
        </Typography.Text>
      )}
      {koerper}
      <Modal
        open={ziel != null}
        title="Meldung zurücknehmen?"
        okText="Zurücknehmen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        confirmLoading={ruecknahme.isPending}
        onOk={() => {
          if (ziel) ruecknahme.mutate(ziel.id);
        }}
        // Solange die Rücknahme läuft, führt KEIN Weg hinaus: ein Fehlschlag danach hätte
        // weder Dialog noch Toast und ginge still verloren (H14/LFH-535).
        onCancel={() => {
          if (!ruecknahme.isPending) setZiel(null);
        }}
        cancelButtonProps={{ disabled: ruecknahme.isPending }}
        closable={!ruecknahme.isPending}
        keyboard={!ruecknahme.isPending}
        mask={{ closable: !ruecknahme.isPending }}
        focusTriggerAfterClose={!fokusZurueck}
        afterClose={() => {
          if (fokusZurueck) wurzel.current?.focus();
        }}
        destroyOnHidden
      >
        {ziel && (
          <>
            <p>
              Meldung {ziel.text} von {formatZeitKurz(ziel.zeitpunkt_at, konventionen)}{' '}
              zurücknehmen. Die Meldung bleibt im Verlauf und im ETB stehen, gekennzeichnet als
              zurückgenommen.
            </p>
            <p>{rueckfrageHinweis(art, ziel.aktuell)}</p>
            <SpeicherFehler fehler={ruecknahme.error} titel="Rücknahme fehlgeschlagen" />
          </>
        )}
      </Modal>
    </div>
  );
}
