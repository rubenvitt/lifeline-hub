import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ListenPaneel,
  NUR_VORLESER,
  listenZeileStil,
  schriftGroesse,
  schriftStil,
  useRollen,
} from '../../components/instrument';
import { IconHaken } from '../../icons';
import type { StartPunkt } from './startliste';

/**
 * Paneel „Einsatz starten“ im Überblick (LLH-1815, Spec `ueberblick-startliste`, design.md D2):
 * ein `ListenPaneel` mit den fünf Punkten der Startliste, kein eigener Baustein. Die Regeln
 * („erledigt“, Sperre, Ziel) rechnet `startliste.ts`; hier wird nur gezeichnet.
 *
 * Je Zustand eine Zeile: Haken mit Wert (erledigt), leerer Kreis als Link in die Erfassung (offen),
 * „—“ mit Grund (gesperrt, unbekannt). Keine Zahl: die Startliste zeigt Haken, keine Kennzahl
 * (Spec `lage-verdichtung`). „Ausblenden“ steht als Kopf-Aktion des `DashboardPaneel`.
 */
export const STARTLISTE_TITEL = 'Einsatz starten';

/** Wort für Vorleser je Zustand, damit der Name einer Zeile nicht nur am Zeichen hängt. */
const ZUSTAND_WORT: Record<StartPunkt['zustand'], string> = {
  erledigt: 'erledigt',
  offen: 'offen',
  gesperrt: 'gesperrt',
  unbekannt: 'unbekannt',
};

export default function StartlistePaneel({
  punkte,
  onAusblenden,
  onNeuladen,
}: {
  punkte: readonly StartPunkt[];
  onAusblenden: () => void;
  onNeuladen: () => void;
}) {
  const { token, rollen } = useRollen();
  const zeile: CSSProperties = { ...listenZeileStil(rollen, token), alignItems: 'center' };

  /** Zeichen links: Haken, leerer Kreis oder Strich; feste Breite, damit die Titel fluchten. */
  const zeichen = (p: StartPunkt): ReactNode => {
    const rahmen: CSSProperties = {
      flex: '0 0 auto',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      inlineSize: 16,
    };
    if (p.zustand === 'erledigt') {
      return (
        <span aria-hidden="true" style={{ ...rahmen, color: rollen.normalText }}>
          <IconHaken size={14} />
        </span>
      );
    }
    if (p.zustand === 'offen') {
      return (
        <span aria-hidden="true" style={rahmen}>
          <span
            style={{
              inlineSize: 10,
              blockSize: 10,
              borderRadius: '50%',
              border: `1.5px solid ${rollen.bedienText}`,
              boxSizing: 'border-box',
            }}
          />
        </span>
      );
    }
    return (
      <span aria-hidden="true" style={{ ...rahmen, color: rollen.gedaempft }}>
        —
      </span>
    );
  };

  /** Rechte Spalte: Wert und Zusatz (erledigt) bzw. Grund (gesperrt, unbekannt). */
  const angabe = (p: StartPunkt): ReactNode => {
    if (p.zustand === 'erledigt' && p.wert) {
      return (
        <span style={{ minWidth: 0, overflowWrap: 'anywhere', color: rollen.text2 }}>
          {p.wert}
          {p.zusatz && (
            <span style={{ ...schriftStil('meta'), color: rollen.achtungText }}>
              {' · '}
              {p.zusatz}
            </span>
          )}
        </span>
      );
    }
    if (p.grund) {
      return <span style={{ ...schriftStil('meta'), color: rollen.gedaempft }}>{p.grund}</span>;
    }
    return null;
  };

  const inhalt = (p: StartPunkt) => (
    <>
      {zeichen(p)}
      <span
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: token.paddingSM,
          rowGap: 2,
          fontSize: schriftGroesse('klein'),
        }}
      >
        <span style={{ fontWeight: 500 }}>{p.titel}</span>
        <span style={NUR_VORLESER}> {ZUSTAND_WORT[p.zustand]}</span>
        {angabe(p)}
      </span>
    </>
  );

  return (
    <ListenPaneel<StartPunkt>
      titel={STARTLISTE_TITEL}
      zustand="daten"
      kopfAktion={{ label: 'Ausblenden', onKlick: onAusblenden }}
      // Die Liste hat immer fünf Punkte; leer und gesperrt kommen nicht vor.
      leerText=""
      gesperrtText=""
      onNeuladen={onNeuladen}
      eintraege={punkte}
      max={punkte.length}
      schluessel={(p) => p.schluessel}
      zeile={(p) =>
        p.zustand === 'offen' && p.ziel ? (
          <Link
            to={p.ziel}
            data-lfh="startliste-punkt"
            data-schluessel={p.schluessel}
            data-zustand={p.zustand}
            style={zeile}
          >
            {inhalt(p)}
          </Link>
        ) : (
          <div
            data-lfh="startliste-punkt"
            data-schluessel={p.schluessel}
            data-zustand={p.zustand}
            style={zeile}
          >
            {inhalt(p)}
          </div>
        )
      }
    />
  );
}
