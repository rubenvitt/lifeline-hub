import { CheckOutlined } from '@ant-design/icons';
import { Link } from 'react-router';
import type { EtbEintragAnzeige, EtbZaehler } from '../api/types';
import {
  Augenbraue,
  Balken,
  Paneel,
  PaneelZeile,
  StatusChip,
  monoStil,
  useRollen,
} from '../components/instrument';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit } from '../anzeige/format';
import { etbPfad } from '../routing/deeplinks';
import { etbTypFarbe } from '../theme/statusFarben';
import {
  berichtigungsindex,
  kopfMeta,
  letzteBerichtigungen,
  typBilanz,
  verweisStil,
  type PufferZustand,
} from './zeitachseModell';

interface Props {
  einsatzId: number;
  /** Die geladenen, gesendeten Einträge (ohne Puffer) — Quelle der Berichtigungen. */
  eintraege: readonly EtbEintragAnzeige[];
  /** Serverseitige Zählung über denselben Filter wie die Liste; fehlt, solange sie lädt
   *  oder gescheitert ist (LFH-612). */
  zaehler: EtbZaehler | undefined;
  /** Die Zählung ist gescheitert (sonst: sie lädt noch). */
  zaehlerFehler: boolean;
  filterAktiv: boolean;
  puffer: PufferZustand;
  /** Der Listenabruf läuft oder ist gescheitert — dann gibt es keine Berichtigungen. */
  unbestimmt: boolean;
}

/** Die Mehrzahl der Bilanzzeile — „Meldungen", nicht „Meldung". */
const MEHRZAHL: Record<EtbEintragAnzeige['typ'], string> = {
  meldung: 'Meldungen',
  anordnung: 'Anordnungen',
  entscheidung: 'Entscheidungen',
  lage: 'Lagemeldungen',
  berichtigung: 'Berichtigungen',
  system: 'Systemeinträge',
};

/**
 * Die Seitenleiste des Einsatztagebuchs (Neuentwurf S4): Bilanz nach Typ, jüngste
 * Berichtigungen, Zustand des Puffers.
 *
 * ── WARUM „BILANZ" UND NICHT „TAGESBILANZ" ─────────────────────────────────────────
 *
 * Der Entwurf zeigt „Tagesbilanz" mit Summen wie „218 Meldungen" — die sich dort aber zur
 * Gesamtzahl des Kopfs („412 Einträge") addieren, also gerade keinen Kalendertag zählen.
 * Seit LFH-612 zählt der Server exakt, und zwar über DENSELBEN Filter wie die Liste
 * (Entscheidung vom 22.09.2026): ohne Filter das ganze Tagebuch („Bilanz"), mit Filter
 * genau die Treffer („Bilanz im Filter"). Wer einen Tag sehen will, setzt den
 * Zeitraumfilter — eine feste Tagesgrenze bräuchte eine Zeitzone, die der Server nicht
 * kennt. Die Balken messen gegen die Gesamtzahl derselben Zählung.
 *
 * Solange die Zählung lädt oder gescheitert ist, steht KEINE Zahl da: eine Zählung des
 * geladenen Fensters behauptete eine Vollständigkeit, die es nicht gibt.
 *
 * Die Berichtigungen darunter kommen weiter aus den geladenen Einträgen und sagen das.
 */
export default function EtbBilanz({
  einsatzId,
  eintraege,
  zaehler,
  zaehlerFehler,
  filterAktiv,
  puffer,
  unbestimmt,
}: Props) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const bilanz = zaehler ? typBilanz(zaehler.je_typ) : [];
  const gesamt = zaehler?.gesamt ?? 0;
  const menge = filterAktiv
    ? gesamt === 1
      ? 'Treffer'
      : 'Treffern'
    : gesamt === 1
      ? 'Eintrag'
      : 'Einträgen';
  const berichtigungen = letzteBerichtigungen(eintraege);
  const index = berichtigungsindex(eintraege);

  return (
    <Paneel
      titel={filterAktiv ? 'Bilanz im Filter' : 'Bilanz'}
      meta={kopfMeta({ gesamt: zaehler?.gesamt, filterAktiv })}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: token.margin,
          padding: token.padding,
        }}
      >
        {!zaehler ? (
          <span data-lfh="bilanz-offen" style={{ fontSize: 11, color: rollen.gedaempft }}>
            {zaehlerFehler ? 'Zählung nicht verfügbar.' : 'Zählung folgt …'}
          </span>
        ) : (
          <>
            {bilanz.map((b) => (
              <div
                key={b.typ}
                data-typ={b.typ}
                style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: 11, color: rollen.gedaempft }}>{MEHRZAHL[b.typ]}</span>
                  <span style={{ ...monoStil(18, 500), color: rollen.text }}>{b.anzahl}</span>
                </div>
                <Balken
                  wert={b.anzahl}
                  max={gesamt}
                  farbe={etbTypFarbe(b.typ, token).kante}
                  beschriftung={`${MEHRZAHL[b.typ]}: ${b.anzahl} von ${gesamt} ${menge}`}
                />
              </div>
            ))}
          </>
        )}
      </div>

      <PaneelZeile style={{ borderBlockStart: `1px solid ${rollen.linie}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
          <Augenbraue als="h3">Berichtigungen</Augenbraue>
          {berichtigungen.length === 0 ? (
            <span style={{ fontSize: 11, color: rollen.gedaempft }}>
              {unbestimmt ? '—' : 'Keine in den geladenen Einträgen.'}
            </span>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {berichtigungen.map((b) => {
                const grund = index.grundeintrag(b);
                return (
                  <li
                    key={b.id}
                    style={{ display: 'flex', alignItems: 'stretch', gap: token.marginXS }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        flex: '0 0 2px',
                        background: etbTypFarbe('berichtigung', token).kante,
                      }}
                    />
                    <Link
                      to={etbPfad(einsatzId, { eintrag: b.id })}
                      style={{ ...verweisStil(token), fontSize: 11, lineHeight: 1.5 }}
                    >
                      Nr. {b.lfd_nr} berichtigt
                      {grund?.lfd_nr != null
                        ? ` Nr. ${grund.lfd_nr}`
                        : ' einen älteren Eintrag'} um {formatUhrzeit(b.ereigniszeit, konventionen)}
                      <span aria-hidden="true"> ↗</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PaneelZeile>

      <PaneelZeile style={{ borderBlockEnd: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
          <Augenbraue als="h3">Puffer</Augenbraue>
          <Pufferanzeige puffer={puffer} />
        </div>
      </PaneelZeile>
    </Paneel>
  );
}

/**
 * Zustand der Offline-Warteschlange mit zweitem Kanal: Wort + Zahl + Ikone bzw. Fläche.
 * Die Einzelheiten (Wortlaut je Eintrag, Erneut senden / Verwerfen) stehen in den
 * Hinweisen über der Zeitachse und in den Zeilen selbst — hier nur der Stand.
 */
function Pufferanzeige({ puffer }: { puffer: PufferZustand }) {
  const { token, rollen } = useRollen();
  if (puffer.art === 'uebertragen') {
    return (
      <span
        data-lfh="puffer"
        data-zustand="uebertragen"
        style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.normalText }}>
          <CheckOutlined />
        </span>
        <span style={{ fontSize: 11, color: rollen.gedaempft }}>Alle Einträge übertragen</span>
      </span>
    );
  }
  return (
    <span
      data-lfh="puffer"
      data-zustand={puffer.art}
      style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}
    >
      {puffer.art === 'abgelehnt' && (
        <StatusChip ton="alarm" code={puffer.abgelehnt} wort="abgelehnt" />
      )}
      {puffer.ausstehend > 0 && (
        <StatusChip ton="achtung" code={puffer.ausstehend} wort="ausstehend" />
      )}
    </span>
  );
}
