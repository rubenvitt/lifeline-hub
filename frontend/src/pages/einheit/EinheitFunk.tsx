import { Input } from 'antd';
import { EINHEIT_ERREICHBARKEIT_MAX } from '../../api/eingabegrenzen';
import { leerZuNull } from '../../api/patchTriState';
import type { Einheit } from '../../api/types';
import { InlineAngabe } from '../../components/InlineAngabe';
import { Datenfeld, Datenraster, Paneel, monoStil } from '../../components/instrument';
import {
  KOMMUNIKATIONSMITTEL_OPTIONEN,
  kommunikationsmittelLabel,
  mitBetriebsart,
  teileSprechgruppen,
} from '../../components/kommunikationsmittel';
import { Select } from '../../components/Select';
import SprechgruppenPicker from '../../components/SprechgruppenPicker';
import type { EinheitPatchHandler } from './EinheitKopf';

const isSameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && b.every((id) => a.includes(id));

/**
 * Womit man die Einheit erreicht (LLH-1036, design.md D2): Sprechgruppen, Kommunikationsmittel,
 * Erreichbarkeit — je eine Zeile, wie im Abschnittsdetail (LFH-1208). Die Lesezeile
 * `FunkErreichbarkeit` entfällt hier, weil die drei Zeilen dasselbe zeigen.
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
    <Paneel titel="Funk und Kommunikation" koerperPolster>
      <Datenraster spalten={3} beschriftung="Funk und Kommunikation">
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
        <Datenfeld label="Kommunikationsmittel">
          <InlineAngabe<string | null>
            etikett="Kommunikationsmittel"
            wert={e.kommunikationsmittel ?? null}
            anzeige={kommunikationsmittelLabel(e.kommunikationsmittel)}
            leer={(w) => w == null}
            darfSchreiben={canEdit}
            onSpeichern={(w) => onPatch('Kommunikationsmittel', { kommunikationsmittel: w })}
            eingabe={({ feld, popup, value, onChange }) => (
              <Select<string>
                {...feld}
                {...popup}
                allowClear
                placeholder="Digitalfunk / Mobil / Festnetz"
                options={KOMMUNIKATIONSMITTEL_OPTIONEN}
                value={value ?? undefined}
                onChange={(w) => onChange(w ?? null)}
              />
            )}
          />
        </Datenfeld>
        <Datenfeld label="Erreichbarkeit / Nummer">
          <InlineAngabe<string>
            etikett="Erreichbarkeit / Nummer"
            wert={e.erreichbarkeit ?? ''}
            anzeige={e.erreichbarkeit}
            leer={(w) => w.trim() === ''}
            gleich={(a, b) => a.trim() === b.trim()}
            darfSchreiben={canEdit}
            onSpeichern={(w) =>
              onPatch('Erreichbarkeit / Nummer', { erreichbarkeit: leerZuNull(w) })
            }
            eingabe={({ feld, value, onChange }) => (
              <Input
                {...feld}
                placeholder="z. B. 0151 23456"
                maxLength={EINHEIT_ERREICHBARKEIT_MAX}
                value={value}
                onChange={(ev) => onChange(ev.target.value)}
              />
            )}
          />
        </Datenfeld>
      </Datenraster>
    </Paneel>
  );
}
