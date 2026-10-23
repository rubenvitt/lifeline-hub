import { Space, Tag } from 'antd';
import type { KommunikationsVerbindung, Sprechgruppe } from '../api/types';
import { Datenfeld, monoStil } from './instrument';
import { mitBetriebsart, teileSprechgruppen } from './kommunikationsmittel';
import { istTelefon } from './verbindungen';
import { VerbindungenListe } from './VerbindungenFeld';

/**
 * Funk und Telefon getrennt (LLH-1134, Entscheidung LLH-1126 Option B): Lesezeilen für Abschnitt
 * und Einheit in einem `Datenraster`.
 *
 * - **Funk:** Rufname (Mono) und die zugeordneten Sprechgruppen, „TMO …“/„DMO …“ als neutrale
 *   Marken (LFH-891).
 * - **Telefon:** Festnetz und Mobil aus den Verbindungen, wählbar über `tel:`.
 * - **Weitere Verbindungen:** Fax, E-Mail, Messenger, Melder, Sonstiges — nur, wenn es welche gibt.
 *
 * Ohne Angabe steht „—“; mit `nurGefuellt` entfällt eine leere Zeile (Vorschau).
 */
export default function FunkUndTelefon({
  rufname,
  sprechgruppen,
  verbindungen,
  nurGefuellt = false,
}: {
  rufname?: string | null;
  sprechgruppen?: readonly Sprechgruppe[] | null;
  verbindungen?: readonly KommunikationsVerbindung[] | null;
  nurGefuellt?: boolean;
}) {
  const { tmo, dmo } = teileSprechgruppen(sprechgruppen);
  const ruf = rufname?.trim() || null;
  const hatFunk = ruf != null || tmo.length > 0 || dmo.length > 0;
  const telefon = (verbindungen ?? []).filter((v) => istTelefon(v.mittel));
  const weitere = (verbindungen ?? []).filter((v) => !istTelefon(v.mittel));

  return (
    <>
      {(hatFunk || !nurGefuellt) && (
        <Datenfeld label="Funk" breit>
          {hatFunk ? (
            <Space size={[4, 4]} wrap>
              {ruf && <span style={monoStil(13)}>{ruf}</span>}
              {tmo.map((s) => (
                <Tag key={s.id}>{mitBetriebsart('TMO', s.bezeichnung)}</Tag>
              ))}
              {dmo.map((s) => (
                <Tag key={s.id}>{mitBetriebsart('DMO', s.bezeichnung)}</Tag>
              ))}
            </Space>
          ) : (
            '—'
          )}
        </Datenfeld>
      )}
      {(telefon.length > 0 || !nurGefuellt) && (
        <Datenfeld label="Telefon" breit>
          <VerbindungenListe verbindungen={telefon} />
        </Datenfeld>
      )}
      {weitere.length > 0 && (
        <Datenfeld label="Weitere Verbindungen" breit>
          <VerbindungenListe verbindungen={weitere} />
        </Datenfeld>
      )}
    </>
  );
}
