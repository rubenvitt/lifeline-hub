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

const KANAL_TEXT: Record<'email' | 'fax', { name: string; adresse: string }> = {
  email: { name: 'E-Mail', adresse: 'Mailadresse' },
  fax: { name: 'Fax', adresse: 'Faxnummer' },
};

function adressName(kanal: KanalArt): string {
  return kanal === 'fax' ? KANAL_TEXT.fax.adresse : KANAL_TEXT.email.adresse;
}

/**
 * Abschnitt „Erreichbar per“ im Formular einer bestehenden externen Stelle (LLH-2093, Fax
 * LLH-2095): die Mailadressen und Faxnummern der Stelle, jede sofort gespeichert. Das Formular selbst gehört dem Modal; die
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
  const [kanal, setKanal] = useState<'email' | 'fax'>('email');
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
                  {k.channel === 'fax' ? KANAL_TEXT.fax.name : KANAL_TEXT.email.name}
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
            <SegmentFeld<'email' | 'fax'>
              beschriftung="Kanal der neuen Adresse"
              value={kanal}
              onChange={(w) => {
                setKanal(w);
                setFormFehler(null);
              }}
              optionen={[
                { wert: 'email', label: KANAL_TEXT.email.name },
                { wert: 'fax', label: KANAL_TEXT.fax.name },
              ]}
            />
            <Stapel richtung="zeile" abstand="sm" umbruch>
              <Input
                aria-label={KANAL_TEXT[kanal].adresse}
                aria-invalid={formFehler ? true : undefined}
                aria-describedby={formFehler ? fehlerId : undefined}
                type="text"
                inputMode={kanal === 'fax' ? 'tel' : 'email'}
                placeholder={kanal === 'fax' ? '0511 123456' : 'leitstelle@beispiel.de'}
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
