import { Button, Input, Radio } from 'antd';
import { useId, useState } from 'react';
import { Augenbraue, FeldFehler, Stapel, Textstufe } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useOhneVerbindung } from '../offline/verbindung';
import { kanalKurz } from '../ausgang/kanalAnzeige';
import { useCreateKanal, useDeleteKanal, useExterneStelleKanaele } from '../api/externeStellen';
import { useStammdatenHerkunft } from '../instanz/herkunft';
import type { ExterneStelle } from '../api/types';

/** Höchstlänge einer Adresse, wie der Server sie prüft (RFC 5321). */
const ADRESSE_MAX = 254;
/** Höchstlänge einer Matrix-Adresse in Bytes, wie der Server sie prüft (Spec 2). */
const MATRIX_MAX = 255;
const BESCHRIFTUNG_MAX = 100;

type Art = 'email' | 'matrix';

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
 * Grobe Formprüfung einer Matrix-Adresse: Raum-ID (`!…:server`) oder Alias (`#…:server`), kein
 * Leerraum, beidseitig des Doppelpunkts etwas. Ein `matrix.to`-Link geht nicht durch: der Server
 * packt ihn nicht aus und lehnt ihn ab. Die Antwort des Servers (ruma-Parser) ist maßgeblich.
 */
export function istMatrixFormGueltig(adresse: string): boolean {
  const a = adresse.trim();
  if (a.length === 0 || new TextEncoder().encode(a).length > MATRIX_MAX) return false;
  return /^[!#][^\s:]+:\S+$/.test(a);
}

/**
 * Meldung zu einer ungültigen Matrix-Eingabe; Nutzer-ID und `matrix.to`-Link bekommen den Text
 * des Servers (`externe_stelle::kanal::normalize_matrix`).
 */
function matrixFormFehler(adresse: string): string {
  const a = adresse.trim();
  if (a.startsWith('@')) return 'Nutzer-IDs gehen noch nicht, bitte den Raum eintragen';
  if (/^https?:\/\/matrix\.to\//i.test(a)) {
    return 'matrix.to-Links gehen nicht, bitte Raum-ID oder Alias eintragen';
  }
  return 'Matrix-Raum ungültig';
}

/**
 * Abschnitt „Erreichbar per“ im Formular einer bestehenden externen Stelle (LLH-2093): die
 * Adressen der Stelle (E-Mail oder Matrix-Raum), jede sofort gespeichert. Das Formular selbst gehört dem Modal; die
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
  const [art, setArt] = useState<Art>('email');
  const [adresse, setAdresse] = useState('');
  const [beschriftung, setBeschriftung] = useState('');
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const vomHub = herkunft.istVomHub('externe_stelle', stelle.id);

  const hinzufuegen = () => {
    const gueltig = art === 'matrix' ? istMatrixFormGueltig(adresse) : istMailFormGueltig(adresse);
    if (!gueltig) {
      setFormFehler(art === 'matrix' ? matrixFormFehler(adresse) : 'Mailadresse ungültig');
      return;
    }
    setFormFehler(null);
    const label = beschriftung.trim();
    anlegen.mutate(
      { channel: art, address: adresse.trim(), ...(label ? { label } : {}) },
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
            Noch keine Adresse hinterlegt.
          </Textstufe>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {kanaele.map((k) => (
            <li key={k.id}>
              <Stapel richtung="zeile" abstand="sm" ausrichten="baseline" umbruch>
                <Textstufe stufe="textKlein" ton="gedaempft">
                  {kanalKurz(k.channel)}
                </Textstufe>
                <span data-schrift="kennung">{k.address}</span>
                {k.label && (
                  <Textstufe stufe="textKlein" ton="gedaempft">
                    {k.label}
                  </Textstufe>
                )}
                {!vomHub && (
                  <Button
                    danger
                    aria-label={`Adresse ${k.address} entfernen`}
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
            <Radio.Group
              aria-label="Art der Adresse"
              value={art}
              onChange={(e) => {
                setArt(e.target.value as Art);
                setFormFehler(null);
              }}
              options={[
                { label: 'E-Mail', value: 'email' },
                { label: 'Matrix', value: 'matrix' },
              ]}
            />
            <Stapel richtung="zeile" abstand="sm" umbruch>
              <Input
                aria-label={art === 'matrix' ? 'Matrix-Raum' : 'Mailadresse'}
                aria-invalid={formFehler ? true : undefined}
                aria-describedby={formFehler ? fehlerId : undefined}
                type="text"
                inputMode={art === 'matrix' ? 'text' : 'email'}
                placeholder={art === 'matrix' ? '#lageraum:beispiel.de' : 'leitstelle@beispiel.de'}
                maxLength={art === 'matrix' ? MATRIX_MAX : ADRESSE_MAX}
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
