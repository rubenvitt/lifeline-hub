import { useState, type KeyboardEvent } from 'react';
import { Button, Input, Popconfirm } from 'antd';
import { IconSchloss } from '../icons';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import type { AdapterGeheimnisAnzeige } from '../api/types';
import { Knopfreihe, Stapel, monoStil, useRollen } from './instrument';
import { SpeicherFehler } from './SpeicherHinweis';

export interface GeheimfeldProps {
  /** Der Platz, wie der Server ihn nennt: nie der Wert, nur ob und wann er gesetzt ist. */
  platz: AdapterGeheimnisAnzeige;
  /** Ohne Schreibrecht zeigt die Zeile nur den Stand, ohne Knöpfe; der Grund steht über der Seite. */
  darfSchreiben: boolean;
  /** Gesperrt mit Grund (Geheimnisspeicher ohne Schlüssel): Knöpfe aus, Grund als Titel. */
  gesperrt?: string;
  /** Höchstlänge in Zeichen (`ADAPTER_GEHEIMNIS_MAX`). */
  maxLaenge: number;
  /**
   * Schickt den Wert. Wirft bei Fehler; das Feld ist danach in jedem Fall leer. Nie über
   * `useMutation` anbinden: deren Cache hielte den Wert als `variables`.
   */
  onSetzen: (wert: string) => Promise<void>;
  onEntfernen: () => Promise<void>;
  /** Mit offenem Feld beginnen (Vorschau im Design System); sonst öffnet erst „Setzen“. */
  startOffen?: boolean;
}

/**
 * Geheimfeld (LLH-2018, Entwurf `docs/design/2026-11-22-adapter/Geheimfeld.dc.html`): ein
 * Geheimnis setzen, ersetzen oder entfernen, nie lesen. Die Zeile zeigt nur „gesetzt … von …“,
 * „nicht gesetzt“ (beim Pflichtplatz in Achtung-Farbe) oder „unlesbar“ (mit einem anderen
 * Schlüssel des Servers gesetzt), nie den Wert, auch nicht verdeckt: keine Punkte, keine Länge.
 * „Setzen“/„Ersetzen“ öffnet in der Zeile ein Passwortfeld ohne Autofill; „Speichern“ schickt den
 * Wert und leert das Feld sofort, auch wenn das Senden scheitert. Escape und „Abbrechen“
 * verwerfen. Der Wert lebt nur im State dieser Zeile, nie in einem `Form`-Store oder im
 * Query-Cache. „Entfernen …“ fragt rot nach.
 */
export default function Geheimfeld({
  platz,
  darfSchreiben,
  gesperrt,
  maxLaenge,
  onSetzen,
  onEntfernen,
  startOffen = false,
}: GeheimfeldProps) {
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [offen, setOffen] = useState(startOffen);
  const [wert, setWert] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);

  const schliessen = () => {
    setWert('');
    setFehler(null);
    setOffen(false);
  };

  const speichern = async () => {
    const gesendet = wert;
    // Vergessen, bevor die Antwort kommt: weder Erfolg noch Fehler lassen den Wert stehen.
    setWert('');
    setLaeuft(true);
    setFehler(null);
    try {
      await onSetzen(gesendet);
      setOffen(false);
    } catch (e) {
      setFehler(e);
    } finally {
      setLaeuft(false);
    }
  };

  const tasten = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      schliessen();
    } else if (e.key === 'Enter' && wert.trim() !== '' && !laeuft) {
      e.preventDefault();
      void speichern();
    }
  };

  const zustandText = platz.is_unlesbar ? (
    <span style={{ color: rollen.achtungText }}>
      unlesbar: mit einem anderen Schlüssel des Servers gesetzt
      {platz.gesetzt_at ? ` (${zeitKurz(platz.gesetzt_at, konv)})` : ''}. Neu setzen.
    </span>
  ) : platz.is_gesetzt ? (
    <span>
      gesetzt{' '}
      {platz.gesetzt_at && (
        <span style={monoStil('monoKlein')}>{zeitKurz(platz.gesetzt_at, konv)}</span>
      )}
      {platz.gesetzt_von_name ? ` von ${platz.gesetzt_von_name}` : ''}
    </span>
  ) : platz.pflicht ? (
    <span style={{ color: rollen.achtungText }}>
      nicht gesetzt: der Adapter ruft ohne ihn nicht ab
    </span>
  ) : (
    <span>nicht gesetzt</span>
  );

  const setzenWort = platz.is_unlesbar ? 'Neu setzen' : platz.is_gesetzt ? 'Ersetzen' : 'Setzen';
  const feldId = `geheimfeld-${platz.name}-wert`;

  return (
    <div
      data-testid={`geheimfeld-${platz.name}`}
      data-lfh="geheimfeld"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: token.marginSM,
        paddingBlock: token.paddingXS,
      }}
    >
      <IconSchloss
        aria-hidden
        style={{ color: platz.is_unlesbar ? rollen.achtungText : rollen.gedaempft, flexShrink: 0 }}
      />
      <div style={{ flex: offen ? '0 1 12rem' : '1 1 12rem', minWidth: 0 }}>
        <Stapel abstand="xxs">
          {offen ? (
            <label htmlFor={feldId}>{platz.bezeichnung}</label>
          ) : (
            <span>
              {platz.bezeichnung}
              {platz.pflicht && <span style={{ color: rollen.gedaempft }}> · Pflicht</span>}
            </span>
          )}
          <span style={{ color: rollen.gedaempft, fontSize: token.fontSizeSM }}>
            {offen ? 'neuer Wert, wird nicht wieder angezeigt' : zustandText}
          </span>
        </Stapel>
      </div>
      {offen ? (
        <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
          <Stapel abstand="xs">
            <Knopfreihe>
              <Input.Password
                id={feldId}
                aria-label={`Neuer Wert für ${platz.bezeichnung}`}
                autoComplete="new-password"
                visibilityToggle={false}
                maxLength={maxLaenge}
                value={wert}
                autoFocus
                onChange={(e) => setWert(e.target.value)}
                onKeyDown={tasten}
                style={{ flex: '1 1 12rem', width: 'auto' }}
              />
              <Button
                type="primary"
                loading={laeuft}
                disabled={wert.trim() === ''}
                onClick={() => void speichern()}
              >
                Speichern
              </Button>
              <Button type="text" disabled={laeuft} onClick={schliessen}>
                Abbrechen
              </Button>
            </Knopfreihe>
            <SpeicherFehler fehler={fehler} titel="Nicht gesetzt" />
          </Stapel>
        </div>
      ) : (
        darfSchreiben && (
          <Knopfreihe>
            <span title={gesperrt}>
              <Button disabled={gesperrt != null} onClick={() => setOffen(true)}>
                {setzenWort}
              </Button>
            </span>
            {platz.is_gesetzt && (
              <Popconfirm
                title={`${platz.bezeichnung} entfernen?`}
                description={
                  platz.pflicht
                    ? 'Der Wert ist danach weg. Ohne ihn hält der Adapter beim nächsten Abruf an.'
                    : 'Der Wert ist danach weg und lässt sich nicht wiederherstellen.'
                }
                okText="Entfernen"
                cancelText="Abbrechen"
                okButtonProps={{ danger: true }}
                onConfirm={onEntfernen}
              >
                <Button type="text">Entfernen …</Button>
              </Popconfirm>
            )}
          </Knopfreihe>
        )
      )}
    </div>
  );
}
