import { useRef } from 'react';
import type { Einheit } from '../../api/types';
import { InlineAngabe } from '../../components/InlineAngabe';
import { Datenfeld, Datenraster, Paneel, monoStil } from '../../components/instrument';
import { mitBetriebsart, teileSprechgruppen } from '../../components/kommunikationsmittel';
import SprechgruppenPicker from '../../components/SprechgruppenPicker';
import { VerbindungenAngabe } from '../../components/VerbindungenFeld';
import type { EinheitPatchHandler } from './EinheitKopf';

const isSameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && b.every((id) => a.includes(id));

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
export type EinheitSprechgruppenHandler = (
  aenderung: SprechgruppenAenderung,
  onSchritt: (schritt: SprechgruppenSchritt) => void,
) => Promise<unknown>;

/**
 * Womit man die Einheit erreicht (LLH-1036, design.md D2; LLH-1134): Funk und Telefon getrennt,
 * wie im Abschnittsdetail (LFH-1208). Paneel „Funk“ mit den Sprechgruppen (der Funkrufname steht
 * im Kopf), Paneel „Telefon und weitere Verbindungen“ mit der typisierten Liste
 * (`VerbindungenAngabe`, ersetzt als Ganzes über `verbindungen`).
 *
 * Die Sprechgruppen gehen einzeln (LLH-1265, Change `pcrn0wn1-einheit-sprechgruppen-einzelwege`,
 * D1): gesendet wird nur die Differenz zum Stand beim Öffnen der Zeile. Eine Sprechgruppe, die ein
 * anderer Arbeitsplatz oder die Fernmeldeskizze inzwischen zugeordnet oder gelöst hat, bleibt so
 * unberührt; gegen den Live-Stand gerechnet, löste das Speichern sie wieder.
 */
export default function EinheitFunk({
  einheit: e,
  einsatzId,
  canEdit,
  onPatch,
  onSprechgruppen,
}: {
  einheit: Einheit;
  einsatzId: number;
  canEdit: boolean;
  onPatch: EinheitPatchHandler;
  onSprechgruppen: EinheitSprechgruppenHandler;
}) {
  const sprechgruppenIds = (e.sprechgruppen ?? []).map((s) => s.id);
  // Vergleichsstand: der Serverstand beim Öffnen, fortgeschrieben um jeden angekommenen Schritt.
  // Nach einer Teilablehnung bleibt die Zeile offen; ein erneutes Speichern schickt dann nur, was
  // gegenüber dem Gespeicherten fehlt, und schließt nicht still ohne Anfrage.
  const idsAtOpenRef = useRef<number[]>(sprechgruppenIds);
  function saveSprechgruppen(neu: number[]) {
    const alt = idsAtOpenRef.current;
    const aenderung = {
      hinzu: neu.filter((id) => !alt.includes(id)),
      weg: alt.filter((id) => !neu.includes(id)),
    };
    // Nur fremde Änderungen seit dem Öffnen: hier ist nichts zu senden.
    if (aenderung.hinzu.length === 0 && aenderung.weg.length === 0) return Promise.resolve();
    return onSprechgruppen(aenderung, ({ art, id }) => {
      const ids = idsAtOpenRef.current;
      idsAtOpenRef.current = art === 'hinzu' ? [...ids, id] : ids.filter((x) => x !== id);
    });
  }
  const { tmo, dmo } = teileSprechgruppen(e.sprechgruppen);
  const sprechgruppenText = [
    tmo.length > 0 ? mitBetriebsart('TMO', tmo.map((s) => s.bezeichnung).join(', ')) : null,
    dmo.length > 0 ? mitBetriebsart('DMO', dmo.map((s) => s.bezeichnung).join(', ')) : null,
  ]
    .filter((t): t is string => t != null)
    .join(' · ');

  return (
    <>
      <Paneel titel="Funk" koerperPolster>
        <Datenraster spalten={1} beschriftung="Funk">
          <Datenfeld label="Sprechgruppen">
            <InlineAngabe<number[]>
              etikett="Sprechgruppen"
              wert={sprechgruppenIds}
              anzeige={<span style={monoStil(13)}>{sprechgruppenText}</span>}
              leer={(ids) => ids.length === 0}
              gleich={isSameIds}
              darfSchreiben={canEdit}
              onOeffnen={() => {
                idsAtOpenRef.current = sprechgruppenIds;
              }}
              onSpeichern={saveSprechgruppen}
              eingabe={({ feld, popup, value, onChange }) => (
                <SprechgruppenPicker
                  einsatzId={einsatzId}
                  value={value}
                  onChange={onChange}
                  auswahl={{ ...feld, ...popup }}
                />
              )}
            />
          </Datenfeld>
        </Datenraster>
      </Paneel>
      <Paneel titel="Telefon und weitere Verbindungen" koerperPolster>
        <VerbindungenAngabe
          etikett="Telefon und weitere Verbindungen"
          verbindungen={e.verbindungen}
          darfSchreiben={canEdit}
          onSpeichern={(liste) =>
            onPatch('Telefon und weitere Verbindungen', { verbindungen: liste })
          }
        />
      </Paneel>
    </>
  );
}
