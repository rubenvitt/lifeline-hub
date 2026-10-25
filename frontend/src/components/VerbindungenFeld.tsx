import { Button, Flex, Input } from 'antd';
import { VERBINDUNGEN_MAX, VERBINDUNG_TEXT_MAX } from '../api/eingabegrenzen';
import type { KommunikationsVerbindung, NeueVerbindung, Verbindungsmittel } from '../api/types';
import { IconMuelleimer, IconPlus } from '../icons';
import { InlineAngabe, type InlineEingabe } from './InlineAngabe';
import { monoStil, useRollen } from './instrument';
import { kennungsLinkStil } from './kennungsLink';
import { Select } from './Select';
import {
  VERBINDUNGSMITTEL_LABEL,
  VERBINDUNGSMITTEL_OPTIONEN,
  alsEingabe,
  bereinigeVerbindungen,
  gleicheVerbindungen,
  verbindungsVerweis,
} from './verbindungen';

/**
 * Baustein „Verbindungen“ (LLH-1134, Entscheidung LLH-1126 Option B): Telefon und weitere
 * Verbindungen außerhalb des Funks als Liste „Mittel · Wert · Hinweis“, wie die Stellen des
 * Kommunikationsplans. Abschnitt, Einheit und eigene Führungsstelle nehmen ihn unter
 * „Telefon und weitere Verbindungen“; Funk (Rufname, Sprechgruppen) steht getrennt davon.
 *
 * - **Lesen** ({@link VerbindungenListe}): je Verbindung das Mittel gedämpft, der Wert in Mono,
 *   `tel:` nur für Festnetz und Mobil, `mailto:` nur mit `@` (`verbindungen.ts`), der Hinweis
 *   gedämpft dahinter. Der Verweis ist ein Bedienziel und trägt den Boden der Dichte-Staffel
 *   (`kennungsLinkStil`, ein `<a>` erbt keine Steuerhöhe).
 * - **Bearbeiten** ({@link VerbindungenAngabe}): eine `InlineAngabe` über die ganze Liste, mit
 *   `bearbeitenDaneben` — die Verweise stehen nicht im Wertknopf, „Bearbeiten“ steht daneben
 *   (LLH-1426: der Klick auf die Nummer wählt). Der Server ersetzt die Liste vollständig
 *   (`verbindungen`). Leere Zeilen fallen beim Speichern weg, ein Hinweis ohne Nummer wird nicht
 *   gesendet. Höchstens `VERBINDUNGEN_MAX` Einträge, Wert und Hinweis je höchstens
 *   `VERBINDUNG_TEXT_MAX` Zeichen (Spiegel der Servergrenzen).
 */

export function VerbindungenListe({
  verbindungen,
}: {
  verbindungen: readonly Pick<KommunikationsVerbindung, 'mittel' | 'wert' | 'hinweis'>[];
}) {
  const { token, rollen } = useRollen();
  if (verbindungen.length === 0) return <>—</>;
  const gedaempft = { color: rollen.text2 };
  return (
    // Die Verweise sind Bedienziele: Zeile über Zeile ≥ 8 / ≥ 16 px auseinander (LFH-630,
    // `paddingSM` 7/11/16), nicht nur der Zeilenabstand des Fließtexts.
    <Flex vertical gap={token.paddingSM}>
      {verbindungen.map((v, i) => {
        const verweis = verbindungsVerweis(v.mittel, v.wert);
        const wert = <span style={{ ...monoStil(13), overflowWrap: 'anywhere' }}>{v.wert}</span>;
        return (
          <Flex key={`${i}-${v.mittel}-${v.wert}`} wrap align="baseline" gap={token.marginXS}>
            <span style={gedaempft}>{VERBINDUNGSMITTEL_LABEL[v.mittel]}</span>
            {verweis ? (
              <a href={verweis} style={kennungsLinkStil(token)}>
                {wert}
              </a>
            ) : (
              wert
            )}
            {v.hinweis && <span style={gedaempft}>{v.hinweis}</span>}
          </Flex>
        );
      })}
    </Flex>
  );
}

/** Grund, warum die Liste so nicht gesendet wird; `null` = in Ordnung. */
export function pruefeVerbindungen(liste: readonly NeueVerbindung[]): string | null {
  for (const [i, v] of liste.entries()) {
    const wert = v.wert.trim();
    const hinweis = v.hinweis?.trim() ?? '';
    if (!wert && hinweis) return `Verbindung ${i + 1}: Nummer oder Adresse fehlt`;
    if (wert.length > VERBINDUNG_TEXT_MAX || hinweis.length > VERBINDUNG_TEXT_MAX) {
      return `Verbindung ${i + 1}: höchstens ${VERBINDUNG_TEXT_MAX} Zeichen`;
    }
  }
  if (bereinigeVerbindungen(liste).length > VERBINDUNGEN_MAX) {
    return `Höchstens ${VERBINDUNGEN_MAX} Verbindungen`;
  }
  return null;
}

/** Die Eingabe der Liste: je Zeile Mittel, Nummer oder Adresse, Hinweis und „entfernen“. */
export function VerbindungenEingabe({
  feld,
  value,
  onChange,
  popup,
}: Pick<InlineEingabe<NeueVerbindung[]>, 'feld' | 'value' | 'onChange' | 'popup'>) {
  const { token } = useRollen();
  const { id, autoFocus, 'aria-label': name, ...pruefMerkmale } = feld;
  const setze = (i: number, teil: Partial<NeueVerbindung>) =>
    onChange(value.map((v, j) => (j === i ? { ...v, ...teil } : v)));
  const voll = value.length >= VERBINDUNGEN_MAX;
  return (
    <div role="group" aria-label={name} {...pruefMerkmale}>
      <Flex vertical gap={token.marginXS}>
        {value.map((v, i) => {
          const nr = i + 1;
          return (
            <Flex key={i} wrap gap={token.marginXS} align="center">
              <Select<Verbindungsmittel>
                {...popup}
                aria-label={`Mittel ${nr}`}
                style={{ minWidth: 130 }}
                options={VERBINDUNGSMITTEL_OPTIONEN}
                value={v.mittel}
                onChange={(m) => setze(i, { mittel: m })}
              />
              <Input
                {...(i === 0 ? { id, autoFocus } : {})}
                aria-label={`Nummer oder Adresse ${nr}`}
                style={{ flex: '1 1 160px', minWidth: 0, ...monoStil(13) }}
                placeholder="z. B. 0170 1234567"
                maxLength={VERBINDUNG_TEXT_MAX}
                value={v.wert}
                onChange={(e) => setze(i, { wert: e.target.value })}
              />
              <Input
                aria-label={`Hinweis ${nr}`}
                style={{ flex: '1 1 140px', minWidth: 0 }}
                placeholder="z. B. nur tagsüber"
                maxLength={VERBINDUNG_TEXT_MAX}
                value={v.hinweis ?? ''}
                onChange={(e) => setze(i, { hinweis: e.target.value })}
              />
              <Button
                aria-label={`Verbindung ${nr} entfernen`}
                icon={<IconMuelleimer />}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              />
            </Flex>
          );
        })}
        <div>
          <Button
            {...(value.length === 0 ? { id, autoFocus } : {})}
            icon={<IconPlus />}
            disabled={voll}
            onClick={() => onChange([...value, { mittel: 'mobil', wert: '' }])}
          >
            Verbindung hinzufügen
          </Button>
        </div>
      </Flex>
    </div>
  );
}

/**
 * Die Verbindungen eines Datensatzes, inline bearbeitbar. `onSpeichern` bekommt die bereinigte
 * Ersatzliste (getrimmt, ohne leere Zeilen) und schickt sie als `verbindungen`.
 */
export function VerbindungenAngabe({
  etikett,
  verbindungen,
  darfSchreiben,
  onSpeichern,
  gesperrt,
}: {
  etikett: string;
  verbindungen: readonly KommunikationsVerbindung[] | null | undefined;
  darfSchreiben: boolean;
  onSpeichern: (liste: NeueVerbindung[]) => Promise<unknown>;
  gesperrt?: string | { beschreibungId: string };
}) {
  const wert = alsEingabe(verbindungen);
  return (
    <InlineAngabe<NeueVerbindung[]>
      etikett={etikett}
      wert={wert}
      anzeige={<VerbindungenListe verbindungen={wert} />}
      leer={(l) => l.length === 0}
      gleich={(a, b) => gleicheVerbindungen(bereinigeVerbindungen(a), bereinigeVerbindungen(b))}
      darfSchreiben={darfSchreiben}
      gesperrt={gesperrt}
      bearbeitenDaneben
      pruefe={pruefeVerbindungen}
      onSpeichern={(l) => onSpeichern(bereinigeVerbindungen(l))}
      eingabe={(p) => <VerbindungenEingabe {...p} />}
    />
  );
}
