import { useRef } from 'react';
import type { Sprechgruppe } from '../api/types';
import { InlineAngabe } from './InlineAngabe';
import { monoStil } from './instrument';
import { mitBetriebsart, teileSprechgruppen } from './kommunikationsmittel';
import SprechgruppenPicker from './SprechgruppenPicker';

/** Was das Speichern der Sprechgruppen ändert: je Eintrag eine Zuordnung bzw. Lösung. */
export interface SprechgruppenAenderung {
  hinzu: number[];
  weg: number[];
}

/** Ein am Server angekommener Teil der Änderung. */
export type SprechgruppenSchritt = { art: 'hinzu' | 'weg'; id: number };

/**
 * Schreibt die Änderung über die Einzelwege (LLH-1265, D2) und meldet jeden angekommenen Schritt
 * über `onSchritt`. Erfüllt erst, wenn der neue Stand im Cache steht; lehnt bei der ersten
 * Ablehnung ab, dann zeigt die Zeile den Grund.
 */
export type SprechgruppenHandler = (
  aenderung: SprechgruppenAenderung,
  onSchritt: (schritt: SprechgruppenSchritt) => void,
) => Promise<unknown>;

/**
 * Der Ablauf hinter einem `SprechgruppenHandler` (LLH-1265, D2; LLH-1456, D1): erst alle Lösungen,
 * dann alle Zuordnungen, eine Anfrage nach der anderen, damit ein Tausch sich im ETB als
 * „entfernt … zugeordnet“ liest. Jeder angekommene Schritt geht an `onSchritt`; die erste
 * Ablehnung hält an und wird weitergereicht. `nachladen` läuft in jedem Fall, auch nach einer
 * Teilablehnung, denn die Wege antworten ohne Körper.
 */
export async function schreibeSprechgruppen({
  aenderung,
  onSchritt,
  zuordnen,
  loesen,
  nachladen,
}: {
  aenderung: SprechgruppenAenderung;
  onSchritt: (schritt: SprechgruppenSchritt) => void;
  zuordnen: (sprechgruppeId: number) => Promise<unknown>;
  loesen: (sprechgruppeId: number) => Promise<unknown>;
  nachladen: () => Promise<unknown>;
}): Promise<void> {
  try {
    for (const id of aenderung.weg) {
      await loesen(id);
      onSchritt({ art: 'weg', id });
    }
    for (const id of aenderung.hinzu) {
      await zuordnen(id);
      onSchritt({ art: 'hinzu', id });
    }
  } finally {
    await nachladen();
  }
}

/** Sprechgruppen als eine Zeile: „TMO 311, 312 · DMO 505“, dieselbe Teilung wie der Funkplan. */
export function sprechgruppenText(sprechgruppen: readonly Sprechgruppe[] | null | undefined) {
  const { tmo, dmo } = teileSprechgruppen(sprechgruppen);
  return [
    tmo.length > 0 ? mitBetriebsart('TMO', tmo.map((s) => s.bezeichnung).join(', ')) : null,
    dmo.length > 0 ? mitBetriebsart('DMO', dmo.map((s) => s.bezeichnung).join(', ')) : null,
  ]
    .filter((t): t is string => t != null)
    .join(' · ');
}

const isSameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && b.every((id) => a.includes(id));

/**
 * Zeile „Sprechgruppen“ an Einheit, Abschnitt und Führungsstelle (LLH-1265, Change
 * `pcrn0wn1-einheit-sprechgruppen-einzelwege`, D1; LLH-1456, Change
 * `tjh219fc-abschnitt-fuehrungsstelle-sprechgruppen-einzelwege`, D1): gesendet wird nur die
 * Differenz zum Stand beim Öffnen der Zeile. Eine Sprechgruppe, die ein anderer Arbeitsplatz oder
 * die Fernmeldeskizze inzwischen zugeordnet oder gelöst hat, bleibt so unberührt; gegen den
 * Live-Stand gerechnet, löste das Speichern sie wieder.
 */
export default function SprechgruppenAngabe({
  sprechgruppen,
  einsatzId,
  darfSchreiben,
  onSpeichern,
}: {
  sprechgruppen: readonly Sprechgruppe[] | null | undefined;
  einsatzId: number;
  darfSchreiben: boolean;
  onSpeichern: SprechgruppenHandler;
}) {
  const ids = (sprechgruppen ?? []).map((s) => s.id);
  // Vergleichsstand: der Serverstand beim Öffnen, fortgeschrieben um jeden angekommenen Schritt.
  // Nach einer Teilablehnung bleibt die Zeile offen; ein erneutes Speichern schickt dann nur, was
  // gegenüber dem Gespeicherten fehlt, und schließt nicht still ohne Anfrage.
  const idsAtOpenRef = useRef<number[]>(ids);
  function save(neu: number[]) {
    const alt = idsAtOpenRef.current;
    const aenderung = {
      hinzu: neu.filter((id) => !alt.includes(id)),
      weg: alt.filter((id) => !neu.includes(id)),
    };
    // Nur fremde Änderungen seit dem Öffnen: hier ist nichts zu senden.
    if (aenderung.hinzu.length === 0 && aenderung.weg.length === 0) return Promise.resolve();
    return onSpeichern(aenderung, ({ art, id }) => {
      const stand = idsAtOpenRef.current;
      idsAtOpenRef.current = art === 'hinzu' ? [...stand, id] : stand.filter((x) => x !== id);
    });
  }

  return (
    <InlineAngabe<number[]>
      etikett="Sprechgruppen"
      wert={ids}
      anzeige={<span style={monoStil(13)}>{sprechgruppenText(sprechgruppen)}</span>}
      leer={(w) => w.length === 0}
      gleich={isSameIds}
      darfSchreiben={darfSchreiben}
      onOeffnen={() => {
        idsAtOpenRef.current = ids;
      }}
      onSpeichern={save}
      eingabe={({ feld, popup, value, onChange }) => (
        <SprechgruppenPicker
          einsatzId={einsatzId}
          value={value}
          onChange={onChange}
          auswahl={{ ...feld, ...popup }}
        />
      )}
    />
  );
}
