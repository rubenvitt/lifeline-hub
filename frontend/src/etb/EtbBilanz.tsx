import { CheckOutlined } from '@ant-design/icons';
import { Link } from 'react-router';
import type { EtbEintragAnzeige } from '../api/types';
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
  bilanzUmfang,
  letzteBerichtigungen,
  typBilanz,
  verweisStil,
  type PufferZustand,
} from './zeitachseModell';

interface Props {
  einsatzId: number;
  /** Die geladenen, gesendeten Einträge (ohne Puffer). */
  eintraege: readonly EtbEintragAnzeige[];
  /** Liegen ältere Seiten noch auf dem Server? */
  weitereSeiten: boolean;
  filterAktiv: boolean;
  puffer: PufferZustand;
  /** Der Abruf läuft oder ist gescheitert — dann wird nichts gezählt. */
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
 * ── WARUM „BILANZ" UND NICHT „TAGESBILANZ" — UND WARUM ÜBERHAUPT ────────────────────
 *
 * Der Entwurf zeigt „Tagesbilanz" mit Summen wie „218 Meldungen". Der Server liefert
 * keine Summen je Typ und keine Gesamtzahl (LFH-612), und die Seite lädt das Tagebuch in
 * Fenstern zu hundert Einträgen, neueste zuerst. Eine Zahl ohne Beschriftung behauptete
 * also eine Vollständigkeit, die es nicht gibt — derselbe Einwand, mit dem die
 * Vorgängerin die clientseitige Suche ablehnte.
 *
 * Weggelassen ist sie trotzdem nicht: die Aufteilung der GELADENEN Einträge ist echt und
 * für die laufende Lage nützlich (die jüngsten hundert Einträge sind die Lage). Sie steht
 * deshalb mit ihrem Umfang da — „in 100 geladenen Einträgen — ältere sind nicht
 * mitgezählt" bzw. „in allen 37 Einträgen", wenn wirklich alles geladen ist
 * ({@link bilanzUmfang}). Die Balken messen gegen die geladene Menge, nie gegen eine
 * Gesamtzahl, die es nicht gibt. „Tages-" entfällt: das Fenster ist kein Kalendertag.
 */
export default function EtbBilanz({
  einsatzId,
  eintraege,
  weitereSeiten,
  filterAktiv,
  puffer,
  unbestimmt,
}: Props) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const bilanz = typBilanz(eintraege);
  const umfang = bilanzUmfang({ geladen: eintraege.length, weitereSeiten, filterAktiv });
  const berichtigungen = letzteBerichtigungen(eintraege);
  const index = berichtigungsindex(eintraege);

  return (
    <Paneel titel="Bilanz" meta={unbestimmt ? undefined : 'geladene Einträge'}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: token.margin,
          padding: token.padding,
        }}
      >
        {unbestimmt ? (
          <span style={{ fontSize: 11, color: rollen.gedaempft }}>
            Zählung folgt, sobald die Einträge geladen sind.
          </span>
        ) : (
          <>
            <span data-lfh="bilanz-umfang" style={{ fontSize: 11, color: rollen.gedaempft }}>
              {umfang}
            </span>
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
                  max={eintraege.length}
                  farbe={etbTypFarbe(b.typ, token).kante}
                  beschriftung={`${MEHRZAHL[b.typ]}: ${b.anzahl} von ${eintraege.length} geladenen Einträgen`}
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
