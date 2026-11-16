import { useId, useState } from 'react';
import { Button, Popconfirm, Space, Typography } from 'antd';
import { Paneel, useRollen } from './instrument';
import { SpeicherFehler } from './SpeicherHinweis';

/** Ein endgültiger Schritt im Abschnitt: Auflösen oder Stornieren. */
export interface BeendenSchritt {
  /** Kennung, unter der eine Ablehnung steht. */
  key: string;
  /** Beschriftung des Knopfs und der Bestätigung („UHS auflösen“). */
  knopf: string;
  /** Titel der Rückfrage („UHS auflösen?“). */
  frage: string;
  /** Die Folge in einem Satz. */
  folge: string;
  /** Warum der Schritt gerade nicht geht, in wenigen Wörtern daneben; `null` = möglich. */
  sperre?: string | null;
  /** Titel und Ersatztext einer Ablehnung im Abschnitt. */
  fehlerTitel: string;
  fehlerFallback: string;
  /** Führt aus; lehnt bei Ablehnung ab. Nach Erfolg führt der Aufrufer weiter. */
  ausfuehren: () => Promise<unknown>;
}

/**
 * Der letzte Abschnitt einer Detailseite für endgültiges Beenden (LLH-1722, Spec
 * `bedien-muster`, „Ein Gebilde auflösen oder schließen“ und „Eine Fehlanlage stornieren“;
 * `frontend/AGENTS.md`, „Beenden: Verb, Ort und Sicherung je Art“). Herausgelöst aus „Einheit
 * auflösen oder stornieren“ (LLH-1036 D12, LLH-1881), nach dem Muster des Einsatzabschlusses
 * (LFH-960): abgesetzt von den Angaben, je Schritt ein roter Knopf mit Rückfrage, die die Folge in
 * einem Satz nennt und mit der Handlung bestätigt (`components/rueckfrage.guard.test.ts`). Eine
 * gesperrte Handlung steht gesperrt, der Grund in wenigen Wörtern daneben (LFH-1078). Eine
 * Ablehnung steht im Abschnitt, kein Toast; ein neuer Versuch räumt sie weg.
 *
 * Nur einhängen, wenn mindestens ein Schritt für die Person möglich ist; der Aufrufer entscheidet
 * nach Recht und Zustand.
 */
export default function BeendenAbschnitt({
  titel,
  schritte,
}: {
  titel: string;
  schritte: readonly BeendenSchritt[];
}) {
  const { token } = useRollen();
  const sperreId = useId();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<{ schritt: BeendenSchritt; fehler: unknown } | null>(null);

  function fuehreAus(schritt: BeendenSchritt) {
    setLaeuft(schritt.key);
    setFehler(null);
    schritt
      .ausfuehren()
      .catch((e: unknown) => setFehler({ schritt, fehler: e }))
      .finally(() => setLaeuft(null));
  }

  return (
    <Paneel titel={titel} koerperPolster>
      {fehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler
            fehler={fehler.fehler}
            titel={fehler.schritt.fehlerTitel}
            fallback={fehler.schritt.fehlerFallback}
          />
        </div>
      )}
      <Space size="middle" wrap>
        {schritte.map((s) =>
          s.sperre != null ? (
            <Space key={s.key} size="small" wrap>
              <Button danger disabled aria-describedby={`${sperreId}-${s.key}`}>
                {s.knopf}
              </Button>
              <Typography.Text type="secondary" id={`${sperreId}-${s.key}`}>
                {s.sperre}
              </Typography.Text>
            </Space>
          ) : (
            <Popconfirm
              key={s.key}
              title={s.frage}
              description={s.folge}
              okText={s.knopf}
              okButtonProps={{ danger: true }}
              onConfirm={() => fuehreAus(s)}
            >
              <Button
                danger
                loading={laeuft === s.key}
                disabled={laeuft != null && laeuft !== s.key}
              >
                {s.knopf}
              </Button>
            </Popconfirm>
          ),
        )}
      </Space>
    </Paneel>
  );
}
