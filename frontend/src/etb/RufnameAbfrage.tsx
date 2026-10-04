import { Alert, AutoComplete, Button, Checkbox, Space, Typography } from 'antd';
import { useId, useState } from 'react';
import { useRollen } from '../components/instrument';
import { teilwortSuche } from '../components/teilwortSuche';
import {
  anWieVon as leiteAnWieVonAb,
  standardRufnameWert,
  type StandardRufname,
} from './standardRufname';

interface Props {
  /** Funkrufnamen und Sachgebiete wie an den Von/An-Chips (Freitext bleibt erlaubt). */
  optionen: readonly (string | { value: string; label: string })[];
  /** Der gesetzte Standard beim Ändern, sonst `null` (erste Abfrage). */
  standard: StandardRufname | null;
  /**
   * Erster Vorschlag ohne Standard (Vorrangregel, `anVorbelegung`, Spec `fuehrungsfunktionen`).
   * Er steht vorgewählt im Feld, wird aber erst mit „Übernehmen“ zum Standard.
   */
  vorschlag?: string;
  /** Schreibt den Wert aus `standardRufnameWert`; muss bei Ablehnung ablehnen. */
  onUebernehmen: (wert: string) => Promise<void>;
  /** Nur beim Ändern: zurück, ohne zu speichern. Die erste Abfrage hat keinen Ausweg ohne Wert. */
  onAbbrechen?: () => void;
}

const ERKLAERUNG =
  'Gilt für jeden neuen Eintrag. Mit @ oder /von, /an änderst du ihn für einen einzelnen Eintrag.';

/**
 * Abfrage des Standard-Rufnamens in der ETB-Erfassung (LFH-894, design.md D4): inline über der
 * Eingabezeile statt als Modal, damit die Zeitachse lesbar bleibt. Wie `SchnellAnlegen` ohne
 * `<form>`: sie steht in der Erfassungsleiste, abgeschickt wird über den Knopf und Enter im Feld.
 *
 * „Empfänger wie Absender“ ist die Vorgabe; aus, steht ein zweites Feld da. Gespeichert wird
 * immer ein Paar (`standardRufnameWert`), nie eine Seite allein.
 */
export default function RufnameAbfrage({
  optionen,
  standard,
  vorschlag,
  onUebernehmen,
  onAbbrechen,
}: Props) {
  const { token, rollen } = useRollen();
  const vonId = useId();
  const anId = useId();
  const [von, setVon] = useState(standard?.von ?? vorschlag ?? '');
  const [an, setAn] = useState(standard?.an ?? '');
  const [gleich, setGleich] = useState(leiteAnWieVonAb(standard));
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const auswahl = optionen.map((o) => (typeof o === 'string' ? { value: o } : o));

  async function uebernehmen() {
    if (laeuft) return;
    const wert = standardRufnameWert(von, an, gleich);
    if (wert == null) {
      setFehler(gleich || !von.trim() ? 'Rufname fehlt.' : 'Empfänger fehlt.');
      return;
    }
    setLaeuft(true);
    setFehler(null);
    try {
      await onUebernehmen(wert);
    } catch (e) {
      setFehler(
        `Nicht gespeichert: ${e instanceof Error && e.message ? e.message : 'unbekannter Fehler'}`,
      );
    } finally {
      setLaeuft(false);
    }
  }

  /** Enter im Feld übernimmt; ein offener Vorschlag nimmt Enter selbst (`onSelect`). */
  function beiTaste(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.defaultPrevented) void uebernehmen();
    if (e.key === 'Escape' && onAbbrechen) onAbbrechen();
  }

  const feld = (id: string, wert: string, setze: (v: string) => void, name: string) => (
    <AutoComplete
      id={id}
      aria-label={name}
      value={wert}
      onChange={(v) => {
        setze(v);
        setFehler(null);
      }}
      options={auswahl}
      showSearch={teilwortSuche}
      onKeyDown={beiTaste}
      disabled={laeuft}
      style={{ minWidth: 200, flex: '1 1 200px', maxWidth: 320 }}
    />
  );

  return (
    <div
      role="group"
      aria-labelledby={vonId + '-titel'}
      data-lfh="etb-rufname-abfrage"
      style={{
        marginBottom: token.marginSM,
        padding: token.paddingSM,
        border: `1px solid ${rollen.steuerRahmen}`,
      }}
    >
      <label
        id={vonId + '-titel'}
        htmlFor={vonId}
        style={{ display: 'block', marginBottom: token.marginXXS, color: rollen.text }}
      >
        {standard ? 'Dein Rufname für Von und An' : 'Mit welchem Rufnamen schreibst du ins ETB?'}
      </label>
      <Space wrap align="center">
        {feld(vonId, von, setVon, gleich ? 'Rufname für Von und An' : 'Rufname für Von')}
        <Checkbox checked={gleich} disabled={laeuft} onChange={(e) => setGleich(e.target.checked)}>
          Empfänger wie Absender
        </Checkbox>
        {!gleich && feld(anId, an, setAn, 'Rufname für An')}
        <Button type="primary" loading={laeuft} onClick={() => void uebernehmen()}>
          Übernehmen
        </Button>
        {onAbbrechen && (
          <Button disabled={laeuft} onClick={onAbbrechen}>
            Abbrechen
          </Button>
        )}
      </Space>
      <Typography.Paragraph style={{ margin: 0, marginTop: token.marginXXS, color: rollen.text2 }}>
        {ERKLAERUNG}
      </Typography.Paragraph>
      {fehler && (
        <Alert type="error" showIcon style={{ marginTop: token.marginXS }} title={fehler} />
      )}
    </div>
  );
}
