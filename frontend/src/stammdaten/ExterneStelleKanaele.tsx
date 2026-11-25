import { Button, Input } from 'antd';
import { useId, useState } from 'react';
import { Augenbraue, FeldFehler, Stapel, Textstufe } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useOhneVerbindung } from '../offline/verbindung';
import { useCreateKanal, useDeleteKanal, useExterneStelleKanaele } from '../api/externeStellen';
import { useStammdatenHerkunft } from '../instanz/herkunft';
import type { ExterneStelle } from '../api/types';

/** Höchstlänge einer Adresse, wie der Server sie prüft (RFC 5321). */
const ADRESSE_MAX = 254;
const BESCHRIFTUNG_MAX = 100;

/**
 * Grobe Formprüfung vor dem Senden: genau ein „@“, kein Leerzeichen, kein Komma, beidseitig
 * etwas. Die Antwort des Servers (Adress-Parser) ist maßgeblich.
 */
export function istMailFormGueltig(adresse: string): boolean {
  const a = adresse.trim();
  if (a.length === 0 || a.length > ADRESSE_MAX) return false;
  if (/[\s,]/.test(a)) return false;
  const teile = a.split('@');
  return teile.length === 2 && teile[0] !== '' && teile[1] !== '';
}

/**
 * Abschnitt „Erreichbar per“ im Formular einer bestehenden externen Stelle (LLH-2093): die
 * Mailadressen der Stelle, jede sofort gespeichert. Das Formular selbst gehört dem Modal; die
 * Eingaben hier stehen außerhalb seines `Form` (kein Feld, Enter fügt die Adresse hinzu, statt
 * das Modal abzusenden). Eine Stelle vom Hub ist nur lesbar, ihre Adressen kommen mit.
 */
export default function ExterneStelleKanaele({ stelle }: { stelle: ExterneStelle }) {
  const abfrage = useExterneStelleKanaele(stelle.id);
  const anlegen = useCreateKanal(stelle.id);
  const entfernen = useDeleteKanal(stelle.id);
  const herkunft = useStammdatenHerkunft();
  const ohneNetz = useOhneVerbindung();
  const fehlerId = useId();
  const [adresse, setAdresse] = useState('');
  const [beschriftung, setBeschriftung] = useState('');
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const vomHub = herkunft.istVomHub('externe_stelle', stelle.id);

  const hinzufuegen = () => {
    if (!istMailFormGueltig(adresse)) {
      setFormFehler('Mailadresse ungültig');
      return;
    }
    setFormFehler(null);
    const label = beschriftung.trim();
    anlegen.mutate(
      { channel: 'email', address: adresse.trim(), ...(label ? { label } : {}) },
      {
        onSuccess: () => {
          setAdresse('');
          setBeschriftung('');
        },
      },
    );
  };

  const kanaele = abfrage.data ?? [];

  return (
    <section aria-label="Erreichbar per">
      <Stapel abstand="sm">
        <Augenbraue als="h3">Erreichbar per</Augenbraue>
        {abfrage.isError && <SpeicherFehler fehler={abfrage.error} titel="Nicht geladen" />}
        {kanaele.length === 0 && !abfrage.isLoading && !abfrage.isError && (
          <Textstufe stufe="textKlein" ton="gedaempft">
            Noch keine Mailadresse hinterlegt.
          </Textstufe>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {kanaele.map((k) => (
            <li key={k.id}>
              <Stapel richtung="zeile" abstand="sm" ausrichten="baseline" umbruch>
                <span data-schrift="kennung">{k.address}</span>
                {k.label && (
                  <Textstufe stufe="textKlein" ton="gedaempft">
                    {k.label}
                  </Textstufe>
                )}
                {!vomHub && (
                  <Button
                    danger
                    aria-label={`Mailadresse ${k.address} entfernen`}
                    disabled={ohneNetz}
                    loading={entfernen.isPending && entfernen.variables === k.id}
                    onClick={() => entfernen.mutate(k.id)}
                  >
                    Entfernen
                  </Button>
                )}
              </Stapel>
            </li>
          ))}
        </ul>
        {vomHub ? (
          <Textstufe stufe="textKlein" ton="gedaempft">
            Die Stelle kommt vom Hub; ihre Adressen werden dort gepflegt.
          </Textstufe>
        ) : (
          <Stapel abstand="xs">
            <Stapel richtung="zeile" abstand="sm" umbruch>
              <Input
                aria-label="Mailadresse"
                aria-invalid={formFehler ? true : undefined}
                aria-describedby={formFehler ? fehlerId : undefined}
                type="text"
                inputMode="email"
                placeholder="leitstelle@beispiel.de"
                maxLength={ADRESSE_MAX}
                value={adresse}
                onChange={(e) => {
                  setAdresse(e.target.value);
                  setFormFehler(null);
                }}
                onPressEnter={(e) => {
                  e.preventDefault();
                  hinzufuegen();
                }}
              />
              <Input
                aria-label="Beschriftung"
                placeholder="Beschriftung (optional)"
                maxLength={BESCHRIFTUNG_MAX}
                value={beschriftung}
                onChange={(e) => setBeschriftung(e.target.value)}
                onPressEnter={(e) => {
                  e.preventDefault();
                  hinzufuegen();
                }}
              />
              <Button
                htmlType="button"
                loading={anlegen.isPending}
                disabled={ohneNetz}
                onClick={hinzufuegen}
              >
                Adresse hinzufügen
              </Button>
            </Stapel>
            <FeldFehler id={fehlerId}>{formFehler}</FeldFehler>
          </Stapel>
        )}
        <SpeicherFehler fehler={anlegen.error ?? entfernen.error} titel="Nicht gespeichert" />
      </Stapel>
    </section>
  );
}
