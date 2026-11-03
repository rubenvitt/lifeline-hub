import type { Einheit } from '../../api/types';
import { Datenfeld, Datenraster, Paneel } from '../../components/instrument';
import SprechgruppenAngabe, {
  type SprechgruppenHandler,
} from '../../components/SprechgruppenAngabe';
import { VerbindungenAngabe } from '../../components/VerbindungenFeld';
import type { EinheitPatchHandler } from './EinheitKopf';

/** Speichern der Sprechgruppen über die Einzelwege der Einheit (`SprechgruppenHandler`). */
export type EinheitSprechgruppenHandler = SprechgruppenHandler;

/**
 * Womit man die Einheit erreicht (LLH-1036, design.md D2; LLH-1134): Funk und Telefon getrennt,
 * wie im Abschnittsdetail (LFH-1208). Paneel „Funk“ mit den Sprechgruppen (der Funkrufname steht
 * im Kopf), Paneel „Telefon und weitere Verbindungen“ mit der typisierten Liste
 * (`VerbindungenAngabe`, ersetzt als Ganzes über `verbindungen`).
 *
 * Die Sprechgruppen gehen einzeln (LLH-1265, Change `pcrn0wn1-einheit-sprechgruppen-einzelwege`,
 * D1): `SprechgruppenAngabe` sendet nur die Differenz zum Stand beim Öffnen der Zeile.
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
  return (
    <>
      <Paneel titel="Funk" koerperPolster>
        <Datenraster spalten={1} beschriftung="Funk">
          <Datenfeld label="Sprechgruppen">
            <SprechgruppenAngabe
              sprechgruppen={e.sprechgruppen}
              einsatzId={einsatzId}
              darfSchreiben={canEdit}
              onSpeichern={onSprechgruppen}
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
