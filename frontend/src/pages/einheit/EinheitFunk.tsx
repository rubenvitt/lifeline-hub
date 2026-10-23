import type { Einheit } from '../../api/types';
import { InlineAngabe } from '../../components/InlineAngabe';
import { Datenfeld, Datenraster, Paneel, monoStil } from '../../components/instrument';
import { mitBetriebsart, teileSprechgruppen } from '../../components/kommunikationsmittel';
import SprechgruppenPicker from '../../components/SprechgruppenPicker';
import { VerbindungenAngabe } from '../../components/VerbindungenFeld';
import type { EinheitPatchHandler } from './EinheitKopf';

const isSameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && b.every((id) => a.includes(id));

/**
 * Womit man die Einheit erreicht (LLH-1036, design.md D2; LLH-1134): Funk und Telefon getrennt,
 * wie im Abschnittsdetail (LFH-1208). Paneel „Funk“ mit den Sprechgruppen (der Funkrufname steht
 * im Kopf), Paneel „Telefon und weitere Verbindungen“ mit der typisierten Liste
 * (`VerbindungenAngabe`, ersetzt als Ganzes über `verbindungen`).
 *
 * Die Sprechgruppen gehen als ganze Menge (`sprechgruppe_ids`); ordnet die Fernmeldeskizze
 * zugleich eine zu, gewinnt das spätere Speichern (design.md, Risiken).
 */
export default function EinheitFunk({
  einheit: e,
  einsatzId,
  canEdit,
  onPatch,
}: {
  einheit: Einheit;
  einsatzId: number;
  canEdit: boolean;
  onPatch: EinheitPatchHandler;
}) {
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
              wert={(e.sprechgruppen ?? []).map((s) => s.id)}
              anzeige={<span style={monoStil(13)}>{sprechgruppenText}</span>}
              leer={(ids) => ids.length === 0}
              gleich={isSameIds}
              darfSchreiben={canEdit}
              onSpeichern={(ids) => onPatch('Sprechgruppen', { sprechgruppe_ids: ids })}
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
