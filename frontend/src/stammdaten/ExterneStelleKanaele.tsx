import { Button, Input } from 'antd';
import { useId, useState } from 'react';
import { Augenbraue, FeldFehler, SegmentFeld, Stapel, Textstufe } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useOhneVerbindung } from '../offline/verbindung';
import { useCreateKanal, useDeleteKanal, useExterneStelleKanaele } from '../api/externeStellen';
import { useStammdatenHerkunft } from '../instanz/herkunft';
import type { ExterneStelle, KanalArt } from '../api/types';

/** Höchstlänge einer Adresse, wie der Server sie prüft (RFC 5321). */
const ADRESSE_MAX = 254;
/** Höchstlänge einer Matrix-Adresse in Bytes, wie der Server sie prüft (Spec 2). */
const MATRIX_MAX = 255;
const BESCHRIFTUNG_MAX = 100;

/** Kanäle einer Stelle (Server: `KanalArt::is_freigeschaltet`). */
type Art = KanalArt;

/** Länge einer Threema-ID. */
const THREEMA_LAENGE = 8;
/** Fehlertext wie am Server (`externe_stelle::kanal::normalize_threema`). */
const THREEMA_FEHLER = 'Eine Threema-ID hat acht Zeichen (Buchstaben und Ziffern)';

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
 * Grobe Prüfung einer Faxnummer wie der Server (`normalize_fax`, LLH-2095): `+`, `00` oder eine
 * führende `0`, danach 8 bis 15 Ziffern; Leerzeichen, `-`, `/`, `.`, Klammern und ein `(0)`
 * hinter der Landeskennung zählen nicht. Der Server bringt die Nummer in die Form E.164.
 */
export function istFaxnummerGueltig(roh: string): boolean {
  let a = roh.trim();
  if (a.startsWith('+') || a.startsWith('00')) a = a.replace('(0)', '');
  a = a.replace(/[\s\-/.()]/g, '');
  let ziffern: string;
  if (a.startsWith('+')) ziffern = a.slice(1);
  else if (a.startsWith('00')) ziffern = a.slice(2);
  else if (a.startsWith('0')) ziffern = `49${a.slice(1)}`;
  else return false;
  return /^[1-9][0-9]{7,14}$/.test(ziffern);
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
 * Grobe Prüfung einer Threema-ID wie der Server (LLH-2096): ohne Leerraum, in Großbuchstaben
 * acht Zeichen aus `A–Z` und `0–9`, das erste darf `*` sein. Der Server bringt die ID in Form.
 */
export function istThreemaIdGueltig(roh: string): boolean {
  const a = roh.replace(/\s/g, '').toUpperCase();
  return a.length === THREEMA_LAENGE && /^[A-Z0-9*][A-Z0-9]{7}$/.test(a);
}

const KANAL_TEXT: Record<Art, { name: string; adresse: string }> = {
  email: { name: 'E-Mail', adresse: 'Mailadresse' },
  fax: { name: 'Fax', adresse: 'Faxnummer' },
  matrix: { name: 'Matrix', adresse: 'Matrix-Raum' },
  threema: { name: 'Threema', adresse: 'Threema-ID' },
};

/** Wie eine Adresse heißt (Knopf „… entfernen“). */
function adressName(kanal: KanalArt): string {
  return KANAL_TEXT[kanal].adresse;
}

/**
 * Abschnitt „Erreichbar per“ im Formular einer bestehenden externen Stelle (LLH-2093, Fax
 * LLH-2095, Matrix LLH-2094, Threema LLH-2096): die Adressen der Stelle, jede sofort gespeichert. Das Formular selbst gehört dem Modal; die
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
  const [kanal, setKanal] = useState<Art>('email');
  const [adresse, setAdresse] = useState('');
  const [beschriftung, setBeschriftung] = useState('');
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const vomHub = herkunft.istVomHub('externe_stelle', stelle.id);

  const hinzufuegen = () => {
    if (kanal === 'email' && !istMailFormGueltig(adresse)) {
      setFormFehler('Mailadresse ungültig');
      return;
    }
    if (kanal === 'fax' && !istFaxnummerGueltig(adresse)) {
      setFormFehler('Keine gültige Faxnummer');
      return;
    }
    if (kanal === 'matrix' && !istMatrixFormGueltig(adresse)) {
      setFormFehler(matrixFormFehler(adresse));
      return;
    }
    if (kanal === 'threema' && !istThreemaIdGueltig(adresse)) {
      setFormFehler(THREEMA_FEHLER);
      return;
    }
    setFormFehler(null);
    const label = beschriftung.trim();
    anlegen.mutate(
      { channel: kanal, address: adresse.trim(), ...(label ? { label } : {}) },
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
                  {KANAL_TEXT[k.channel].name}
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
                    aria-label={`${adressName(k.channel)} ${k.address} entfernen`}
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
            <SegmentFeld<Art>
              beschriftung="Kanal der neuen Adresse"
              value={kanal}
              onChange={(w) => {
                setKanal(w);
                setFormFehler(null);
              }}
              optionen={[
                { wert: 'email', label: KANAL_TEXT.email.name },
                { wert: 'fax', label: KANAL_TEXT.fax.name },
                { wert: 'matrix', label: KANAL_TEXT.matrix.name },
                { wert: 'threema', label: KANAL_TEXT.threema.name },
              ]}
            />
            <Stapel richtung="zeile" abstand="sm" umbruch>
              <Input
                aria-label={KANAL_TEXT[kanal].adresse}
                aria-invalid={formFehler ? true : undefined}
                aria-describedby={formFehler ? fehlerId : undefined}
                type="text"
                inputMode={kanal === 'fax' ? 'tel' : kanal === 'email' ? 'email' : 'text'}
                placeholder={
                  kanal === 'fax'
                    ? '0511 123456'
                    : kanal === 'matrix'
                      ? '#lageraum:beispiel.de'
                      : kanal === 'threema'
                        ? 'ECHOECHO'
                        : 'leitstelle@beispiel.de'
                }
                maxLength={kanal === 'matrix' ? MATRIX_MAX : ADRESSE_MAX}
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
