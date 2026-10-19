import { App, Button, Input, InputNumber, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { istKonflikt } from '../api/client';
import {
  ladePerson,
  savePersonFeld,
  type PersonFeld,
  type PersonFeldEingabe,
} from '../api/einsatzPerson';
import { PERSON_ANGABE_MAX, PERSON_NAME_MAX, PERSON_NOTIZ_MAX } from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, PersonDetail } from '../api/types';
import { formatKalenderdatum, parseKalenderdatum } from '../anzeige/kalenderdatum';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe, useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt, heuteInZone } from '../anzeige/zeitEingabe';
import {
  InlineAngabe,
  OFFEN_LASSEN,
  leerKnopfStil,
  type InlineEingabe,
} from '../components/InlineAngabe';
import { Datenfeld, Datenraster } from '../components/instrument';
import { useRollen } from '../components/instrument/rollenwerte';
import {
  OffeneBearbeitungProvider,
  useOffeneBearbeitung,
  useOffeneBearbeitungGrund,
} from '../components/offeneBearbeitung';
import { Select } from '../components/Select';
import { grenzeText, istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../offline/verbindung';
import { serverJetzt } from '../offline/serveruhr';
import { koordinatenText, parseKoordinate } from './koordinate';
import { istAngetroffen } from './personenBilanz';
import { GESCHLECHT_WORT } from './personMeta';
import './Personendaten.css';

dayjs.extend(utc);

/**
 * Personendaten feldweise in der Ansicht (LLH-1103, Change `f8218h1i-personendaten-feldweise`;
 * Spec `personendaten-bearbeiten`). Ersetzt das Sammelformular der Detailseite.
 *
 * - **Jede Angabe ist eine `InlineAngabe`**: ein Tipp öffnet sie, „Speichern“ schickt genau dieses
 *   Feld (`savePersonFeld`), der Toast nennt es („Name gespeichert“), eine Ablehnung steht am Feld.
 * - **Feld-CAS (D1, D2):** beim Öffnen (`onOeffnen`) wird der Serverstand des Felds festgehalten
 *   und als `erwartet` mitgeschickt. Ein 409 lädt das Detail neu; hat sich genau dieses Feld
 *   geändert, fragt „Zwischenzeitlich geändert“ mit dem aktuellen Wert nach („Überschreiben“
 *   sendet ohne Altwert, „Verwerfen und neu laden“ schließt das Feld). Steht der Wert noch wie
 *   beim Öffnen, war es kein Feldkonflikt (etwa ein abgeschlossener Einsatz), und der Grund steht
 *   am Feld.
 * - **Leere Angaben (D5):** mit Schreibrecht als Knöpfe „+ Etikett“ in der Zeile „Ohne Angabe“
 *   (zugänglicher Name „Etikett eintragen“); ein Tipp öffnet das Feld in dieser Zeile. Ohne
 *   Schreibrecht der Satz „Ohne Angabe: …“.
 * - **Eine offene Bearbeitung zur Zeit (D4):** `OffeneBearbeitungProvider` hält den Entwurf, fragt
 *   beim Verlassen nach und sperrt die übrigen Felder. **Ohne Netz (D8)** ist alles gesperrt.
 *   Beide Gründe stehen EINMAL am Kopf des Abschnitts (`frontend/src/personen/AGENTS.md`,
 *   „Personendaten nur feldweise“); die gesperrten Felder verweisen per `aria-describedby` darauf.
 * - **Ein offenes Feld bleibt an seinem Ort**, bis es gespeichert oder abgebrochen ist: seine
 *   Einordnung (Raster oder Zeile „Ohne Angabe“) gilt vom Stand beim Öffnen. Ein neuer Stand, der
 *   den Wert leert oder setzt, hängt es sonst aus, und der Entwurf wäre still weg.
 * - Nach dem Speichern wandert eine Angabe zwischen Raster und Zeile „Ohne Angabe“; der Fokus
 *   folgt ihr auf ihren neuen Auslöser, statt auf `<body>` zu fallen.
 *
 * „Zustand / Verdacht“, PAT-Nummer und Kontamination stehen nur im Patientenkopf.
 */

/** Wie das Backend: „vermisst seit“ höchstens fünf Minuten in der Zukunft (vorgehende Uhr). */
const ZUKUNFT_TOLERANZ_MS = 5 * 60_000;

const GESCHLECHT_OPTIONEN = (
  Object.entries(GESCHLECHT_WORT) as [keyof typeof GESCHLECHT_WORT, string][]
).map(([value, label]) => ({ value, label }));

const isLeerText = (w: string) => w.trim() === '';
const isGleichText = (a: string, b: string) => a.trim() === b.trim();
const textOderNull = (w: string) => (w.trim() === '' ? null : w.trim());

/** Der Serverstand eines Felds, in der Form des Wire-Werts. */
function feldWertAus<K extends PersonFeld>(p: Person, feld: K): PersonFeldEingabe[K] {
  if (feld === 'koordinate') {
    return (
      p.antreff_lat != null && p.antreff_lon != null
        ? { lat: p.antreff_lat, lon: p.antreff_lon }
        : null
    ) as PersonFeldEingabe[K];
  }
  return ((p as unknown as Record<string, unknown>)[feld] ?? null) as PersonFeldEingabe[K];
}

function isGleicherWireWert(a: unknown, b: unknown): boolean {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as { lat: number; lon: number };
    const y = b as { lat: number; lon: number };
    return x.lat === y.lat && x.lon === y.lon;
  }
  return a === b;
}

interface Schreiben {
  /**
   * Schreibt ein Feld mit Feld-CAS; lehnt bei Ablehnung ab (die Eingabe bleibt offen) und erfüllt
   * mit `OFFEN_LASSEN`, wenn die Rückfrage ohne Entscheidung geschlossen wurde.
   */
  speichere: <K extends PersonFeld>(
    feld: K,
    etikett: string,
    wert: PersonFeldEingabe[K],
    erwartet: PersonFeldEingabe[K],
    text: (w: PersonFeldEingabe[K]) => string,
  ) => Promise<void | typeof OFFEN_LASSEN>;
  /** Ein Feld öffnet: sein Ort (Raster oder Zeile „Ohne Angabe“) gilt, bis es schließt. */
  oeffnet: (etikett: string, imRaster: boolean) => void;
  schliesst: (etikett: string) => void;
  /** Kennung der Kopfzeile mit dem Sperrgrund. */
  grundId: string;
  ohneNetz: boolean;
  darfSchreiben: boolean;
}

interface FeldProps<T, K extends PersonFeld> {
  person: Person;
  schreiben: Schreiben;
  feld: K;
  etikett: string;
  /** Entwurf aus dem Serverstand. */
  wert: T;
  anzeige: ReactNode;
  leer: (w: T) => boolean;
  gleich?: (a: T, b: T) => boolean;
  zuWire: (w: T) => PersonFeldEingabe[K];
  /** Wert für die Rückfrage („Inzwischen gespeichert: …“). */
  text: (w: PersonFeldEingabe[K]) => string;
  eingabe: (p: InlineEingabe<T>) => ReactNode;
  pruefe?: (w: T) => string | null;
  isValid?: (w: T) => boolean;
  pflicht?: boolean;
  mehrzeilig?: boolean;
  /** In der Zeile „Ohne Angabe“: Knopf „+ Etikett“ statt der Aufforderung „… eintragen“. */
  inZeileOhneAngabe?: boolean;
}

function PersonFeldAngabe<T, K extends PersonFeld>({
  person,
  schreiben,
  feld,
  etikett,
  zuWire,
  text,
  inZeileOhneAngabe = false,
  ...rest
}: FeldProps<T, K>) {
  const { token, rollen } = useRollen();
  const bearbeitung = useOffeneBearbeitung(etikett);
  // Serverstand beim Öffnen: der Altwert des Feld-CAS. Ein Refetch während der Bearbeitung
  // ändert ihn nicht, sonst überschriebe das Speichern still, was inzwischen dasteht.
  const ausgang = useRef<PersonFeldEingabe[K]>(feldWertAus(person, feld));
  const gesperrt =
    schreiben.ohneNetz || bearbeitung.gesperrt ? { beschreibungId: schreiben.grundId } : undefined;
  return (
    <InlineAngabe<T>
      {...rest}
      etikett={etikett}
      darfSchreiben={schreiben.darfSchreiben}
      gesperrt={gesperrt}
      onEntwurf={bearbeitung.onEntwurf}
      onOeffnen={() => {
        ausgang.current = feldWertAus(person, feld);
        schreiben.oeffnet(etikett, !inZeileOhneAngabe);
      }}
      onSchliessen={() => schreiben.schliesst(etikett)}
      onSpeichern={(w) => schreiben.speichere(feld, etikett, zuWire(w), ausgang.current, text)}
      ausloeser={
        inZeileOhneAngabe
          ? ({ ref, onClick, disabled }) => (
              <Button
                ref={ref}
                type="link"
                disabled={disabled}
                aria-label={`${etikett} eintragen`}
                aria-describedby={disabled ? schreiben.grundId : undefined}
                style={{ ...leerKnopfStil(token, rollen.bedienText), whiteSpace: 'nowrap' }}
                onClick={onClick}
              >
                {`+ ${etikett}`}
              </Button>
            )
          : undefined
      }
    />
  );
}

interface PersonendatenProps {
  einsatzId: number;
  person: PersonDetail;
  /** Schreibrecht im Einsatz, an einer nicht stornierten Person. */
  darfSchreiben: boolean;
  /** „Auf Lagekarte verorten“ (Link oder gesperrter Knopf), nur wo angeboten. */
  verorten?: ReactNode;
  /** Nach jedem gespeicherten Feld (Liste, ETB, Detail abgleichen). */
  onGeschrieben?: () => void;
}

/** Abschnitt „Personendaten“ mit Merker; `key` an der Person, damit kein Entwurf mitwandert. */
export default function Personendaten(props: PersonendatenProps) {
  return (
    <OffeneBearbeitungProvider aktiv={props.darfSchreiben}>
      <PersonendatenInhalt {...props} />
    </OffeneBearbeitungProvider>
  );
}

interface Angabe {
  etikett: string;
  /** Leer im Serverstand → Zeile „Ohne Angabe“. */
  isLeer: boolean;
  /** Steht auch leer im Raster (Koordinate mit Verorten-Weg). */
  imRaster?: boolean;
  mono?: boolean;
  breit?: boolean;
  /** Lesezweig: der Wert ohne Bedienung. */
  lesen: ReactNode;
  schreiben: (inZeileOhneAngabe: boolean) => ReactNode;
  /** Neben der Angabe im Raster (Verorten). */
  zusatz?: ReactNode;
}

function PersonendatenInhalt({
  einsatzId,
  person,
  darfSchreiben,
  verorten,
  onGeschrieben,
}: PersonendatenProps) {
  const { token, rollen } = useRollen();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { zone, formatiere } = useZeitEingabe();
  const ohneNetz = useOhneVerbindung();
  const merkerGrund = useOffeneBearbeitungGrund();
  const grundId = useId();
  const grund = darfSchreiben
    ? ohneNetz
      ? OHNE_VERBINDUNG_NICHT_AENDERBAR
      : merkerGrund
    : undefined;
  const behaelterRef = useRef<HTMLDivElement>(null);
  const [fokusNach, setFokusNach] = useState<{ etikett: string; vorher: Person } | null>(null);
  // Offene Felder (Etikett → im Raster beim Öffnen). Sie bleiben an diesem Ort, bis sie schließen.
  const [offen, setOffen] = useState<Readonly<Record<string, boolean>>>({});
  const oeffnet = (etikett: string, imRaster: boolean) =>
    setOffen((alt) => (alt[etikett] === imRaster ? alt : { ...alt, [etikett]: imRaster }));
  const schliesst = (etikett: string) =>
    setOffen((alt) => {
      if (!(etikett in alt)) return alt;
      const rest = { ...alt };
      delete rest[etikett];
      return rest;
    });

  const detailKey = einsatzKeys.person(einsatzId, person.id);

  function uebernehme(neu: Person) {
    qc.setQueryData<PersonDetail>(detailKey, (alt) => (alt ? { ...alt, ...neu } : alt));
    qc.setQueryData<Person[]>(einsatzKeys.personen(einsatzId), (alt) =>
      alt?.map((x) => (x.id === neu.id ? { ...x, ...neu } : x)),
    );
    onGeschrieben?.();
  }

  const speichere: Schreiben['speichere'] = async (feld, etikett, wert, erwartet, text) => {
    try {
      uebernehme(await savePersonFeld(einsatzId, person.id, feld, wert, erwartet));
    } catch (e) {
      if (!istKonflikt(e)) throw e;
      const frisch = await qc.fetchQuery({
        queryKey: detailKey,
        queryFn: () => ladePerson(einsatzId, person.id),
        staleTime: 0,
      });
      const aktuell = feldWertAus(frisch, feld);
      // Steht das Feld noch wie beim Öffnen, war es kein Feldkonflikt (etwa ein abgeschlossener
      // Einsatz): der Grund des Servers gehört ans Feld.
      if (isGleicherWireWert(aktuell, erwartet)) throw e;
      const entscheidung = await new Promise<'ueberschreiben' | 'verwerfen' | 'offen'>((fertig) => {
        const rueckfrage = modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content: `${etikett} inzwischen: ${aktuell == null ? 'ohne Angabe' : `„${text(aktuell)}“`}`,
          okText: 'Überschreiben',
          okButtonProps: { danger: true },
          onOk: () => fertig('ueberschreiben'),
          // Escape und Schließen entscheiden nichts: weder überschreiben noch verwerfen, das
          // Feld bleibt mit dem Entwurf offen. Darum ist „Verwerfen“ ein eigener Knopf statt
          // antds Abbrechen (das auch Escape auslöst).
          onCancel: () => fertig('offen'),
          footer: (_, { OkBtn }) => (
            <>
              <Button
                onClick={() => {
                  fertig('verwerfen');
                  rueckfrage.destroy();
                }}
              >
                Verwerfen und neu laden
              </Button>
              <OkBtn />
            </>
          ),
        });
      });
      if (entscheidung === 'offen') return OFFEN_LASSEN;
      if (entscheidung === 'verwerfen') return;
      // Ohne Altwert: bewusst über den neuen Stand. Ein zweiter 409 (Einsatz abgeschlossen)
      // steht am Feld.
      uebernehme(await savePersonFeld(einsatzId, person.id, feld, wert, undefined));
    }
    message.success(`${etikett} gespeichert`);
    setFokusNach({ etikett, vorher: person });
  };

  // Der Fokus folgt einer gespeicherten Angabe auf ihren neuen Auslöser (Raster ↔ Zeile „Ohne
  // Angabe“), wenn er sonst auf `<body>` läge. Gewartet wird auf den neuen Stand: bis er kommt,
  // steht noch der alte Auslöser da (`InlineAngabe` gibt ihm den Fokus zurück), danach hängt er
  // aus. Bleibt die Angabe an ihrem Ort, hat `InlineAngabe` den Fokus schon zurückgegeben.
  useEffect(() => {
    // Erst wenn das gespeicherte Feld geschlossen ist: bis dahin steht es noch an seinem Ort.
    if (!fokusNach || person === fokusNach.vorher || fokusNach.etikett in offen) return;
    setFokusNach(null);
    const aktiv = document.activeElement;
    if (aktiv && aktiv !== document.body) return;
    const namen = [`${fokusNach.etikett} bearbeiten`, `${fokusNach.etikett} eintragen`];
    Array.from(behaelterRef.current?.querySelectorAll('button') ?? [])
      .find((knopf) =>
        namen.includes(knopf.getAttribute('aria-label') ?? knopf.textContent?.trim() ?? ''),
      )
      ?.focus();
  }, [fokusNach, person, offen]);

  const schreiben: Schreiben = {
    speichere,
    oeffnet,
    schliesst,
    grundId,
    ohneNetz,
    darfSchreiben,
  };
  const gemeinsam = { person, schreiben };

  const textFeld = (
    feld: 'name' | 'vorname' | 'herkunft_adresse' | 'antreff_ort' | 'melder_kontakt' | 'notiz',
    etikett: string,
    max: number,
    breit = false,
  ): Angabe => {
    const wert = person[feld] ?? '';
    const mehrzeilig = feld === 'notiz';
    return {
      etikett,
      isLeer: isLeerText(wert),
      breit,
      lesen: person[feld],
      schreiben: (inZeileOhneAngabe) => (
        <PersonFeldAngabe<string, typeof feld>
          {...gemeinsam}
          feld={feld}
          etikett={etikett}
          inZeileOhneAngabe={inZeileOhneAngabe}
          wert={wert}
          anzeige={<span style={{ whiteSpace: 'pre-wrap' }}>{wert}</span>}
          leer={isLeerText}
          gleich={isGleichText}
          zuWire={textOderNull}
          text={(w) => w ?? ''}
          // Überlänge als Prüfung am Feld (`FeldFehler`, `aria-invalid`), nie gekürzt.
          pruefe={(w) =>
            istZuLang(w, max)
              ? `${etikett} darf höchstens ${grenzeText(max)} Zeichen lang sein`
              : null
          }
          mehrzeilig={mehrzeilig}
          eingabe={({ feld: f, value, onChange }) =>
            mehrzeilig ? (
              <Input.TextArea
                {...f}
                value={value}
                autoSize={{ minRows: 2 }}
                count={zeichenGrenze(max)}
                onChange={(e) => onChange(e.target.value)}
              />
            ) : (
              <Input
                {...f}
                value={value}
                count={zeichenGrenze(max)}
                onChange={(e) => onChange(e.target.value)}
              />
            )
          }
        />
      ),
    };
  };

  const geschlecht: Angabe = {
    etikett: 'Geschlecht',
    isLeer: !person.geschlecht,
    lesen: person.geschlecht ? GESCHLECHT_WORT[person.geschlecht] : null,
    schreiben: (inZeileOhneAngabe) => (
      <PersonFeldAngabe<string | null, 'geschlecht'>
        {...gemeinsam}
        feld="geschlecht"
        etikett="Geschlecht"
        inZeileOhneAngabe={inZeileOhneAngabe}
        wert={person.geschlecht ?? null}
        anzeige={person.geschlecht ? GESCHLECHT_WORT[person.geschlecht] : null}
        leer={(w) => !w}
        zuWire={(w) => w ?? null}
        text={(w) => (w ? (GESCHLECHT_WORT[w as keyof typeof GESCHLECHT_WORT] ?? w) : '')}
        eingabe={({ feld: f, popup, value, onChange }) => (
          <Select<string>
            {...f}
            {...popup}
            allowClear
            value={value ?? undefined}
            options={GESCHLECHT_OPTIONEN}
            onChange={(w) => onChange(w ?? null)}
            style={{ minWidth: 200 }}
          />
        )}
      />
    ),
  };

  const heute = heuteInZone(zone, serverJetzt());
  const geburtsdatum: Angabe = {
    etikett: 'Geburtsdatum',
    isLeer: !person.geburtsdatum,
    mono: true,
    lesen: person.geburtsdatum ? formatKalenderdatum(person.geburtsdatum) : null,
    schreiben: (inZeileOhneAngabe) => (
      <PersonFeldAngabe<string, 'geburtsdatum'>
        {...gemeinsam}
        feld="geburtsdatum"
        etikett="Geburtsdatum"
        inZeileOhneAngabe={inZeileOhneAngabe}
        wert={formatKalenderdatum(person.geburtsdatum)}
        anzeige={formatKalenderdatum(person.geburtsdatum)}
        leer={isLeerText}
        gleich={isGleichText}
        pruefe={(w) => {
          const r = parseKalenderdatum(w, heute);
          return r.ok ? null : r.grund;
        }}
        zuWire={(w) => {
          const r = parseKalenderdatum(w, heute);
          return r.ok ? r.datum : null;
        }}
        text={(w) => formatKalenderdatum(w)}
        eingabe={({ feld: f, value, onChange }) => (
          <Input
            {...f}
            value={value}
            placeholder="TT.MM.JJJJ"
            inputMode="numeric"
            style={{ fontFamily: token.fontFamilyCode, maxWidth: 200 }}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      />
    ),
  };

  const alter: Angabe = {
    etikett: 'Alter (geschätzt)',
    isLeer: person.alter_geschaetzt == null,
    mono: true,
    lesen: person.alter_geschaetzt,
    schreiben: (inZeileOhneAngabe) => (
      <PersonFeldAngabe<number | null, 'alter_geschaetzt'>
        {...gemeinsam}
        feld="alter_geschaetzt"
        etikett="Alter (geschätzt)"
        inZeileOhneAngabe={inZeileOhneAngabe}
        wert={person.alter_geschaetzt ?? null}
        anzeige={person.alter_geschaetzt}
        leer={(w) => w == null}
        // Nie still gekappt (Spec `personendaten-bearbeiten`, „Prüfungen am Feld“).
        pruefe={(w) =>
          w == null
            ? null
            : !Number.isInteger(w)
              ? 'ganze Zahl'
              : w > 120
                ? 'höchstens 120'
                : w < 0
                  ? 'mindestens 0'
                  : null
        }
        zuWire={(w) => w}
        text={(w) => (w == null ? '' : String(w))}
        eingabe={({ feld: f, value, onChange }) => (
          // Ohne Stufenknöpfe: rc-input-number benennt sie fest englisch (`frontend/AGENTS.md`,
          // „Mengen“).
          <InputNumber<number>
            {...f}
            value={value}
            controls={false}
            inputMode="numeric"
            style={{ fontFamily: token.fontFamilyCode }}
            onChange={(w) => onChange(w ?? null)}
          />
        )}
      />
    ),
  };

  const koordinate = koordinatenText(person);
  const koordinateAngabe: Angabe = {
    etikett: 'Koordinate',
    isLeer: !koordinate,
    // Mit Verorten-Weg steht sie auch leer als Feld: der Wert oder der Weg, ihn zu setzen.
    imRaster: Boolean(verorten),
    breit: true,
    lesen: koordinate ? (
      <span data-lfh="koordinate" style={{ fontFamily: token.fontFamilyCode }}>
        {koordinate}
      </span>
    ) : null,
    zusatz: verorten,
    schreiben: (inZeileOhneAngabe) => (
      <PersonFeldAngabe<string, 'koordinate'>
        {...gemeinsam}
        feld="koordinate"
        etikett="Koordinate"
        inZeileOhneAngabe={inZeileOhneAngabe}
        wert={koordinate ?? ''}
        anzeige={
          <span data-lfh="koordinate" style={{ fontFamily: token.fontFamilyCode }}>
            {koordinate}
          </span>
        }
        leer={isLeerText}
        // Gleichheit am Text: eine unveränderte Koordinate geht nicht auf vier Stellen gerundet
        // zurück (D10).
        gleich={isGleichText}
        pruefe={(w) => {
          if (isLeerText(w)) return null;
          const k = parseKoordinate(w);
          return k.ok ? null : k.grund;
        }}
        zuWire={(w) => {
          if (isLeerText(w)) return null;
          const k = parseKoordinate(w);
          return k.ok ? { lat: k.lat, lon: k.lon } : null;
        }}
        text={(w) => (w ? `${w.lat.toFixed(4)}/${w.lon.toFixed(4)}` : '')}
        eingabe={({ feld: f, value, onChange }) => (
          <Input
            {...f}
            value={value}
            placeholder="52.2691/9.1342"
            style={{ fontFamily: token.fontFamilyCode }}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      />
    ),
  };

  const vermisstSeit: Angabe = {
    etikett: 'vermisst seit',
    isLeer: !person.vermisst_seit,
    mono: true,
    lesen: person.vermisst_seit ? (
      <ZeitAnzeige wert={person.vermisst_seit} format="dtgVoll" />
    ) : null,
    schreiben: (inZeileOhneAngabe) => (
      <PersonFeldAngabe<Dayjs | null, 'vermisst_seit'>
        {...gemeinsam}
        feld="vermisst_seit"
        etikett="vermisst seit"
        inZeileOhneAngabe={inZeileOhneAngabe}
        wert={alsZeitpunkt(person.vermisst_seit) ?? null}
        anzeige={
          person.vermisst_seit ? <ZeitAnzeige wert={person.vermisst_seit} format="dtgVoll" /> : null
        }
        leer={(d) => d === null}
        gleich={(a, b) => (a && b ? a.valueOf() === b.valueOf() : a === b)}
        // Leeren ist am Server ein 400; der alte Wert bleibt.
        pflicht
        pruefe={(d) =>
          d && d.valueOf() > serverJetzt().valueOf() + ZUKUNFT_TOLERANZ_MS
            ? 'liegt in der Zukunft'
            : null
        }
        zuWire={(d) => (d ? alsBackendZeit(d) : '')}
        text={(w) => (w ? formatiere(dayjs.utc(w), 'DD.MM.YYYY HH:mm') : '')}
        eingabe={({ feld: f, popup, value, onChange }) => (
          <ZeitpunktEingabe
            {...f}
            {...popup}
            art="ereignis"
            value={value}
            onChange={(d) => onChange(d ?? null)}
          />
        )}
      />
    ),
  };

  const angetroffen = istAngetroffen(person);
  const angaben: Angabe[] = [
    textFeld('name', 'Name', PERSON_NAME_MAX),
    textFeld('vorname', 'Vorname', PERSON_NAME_MAX),
    geschlecht,
    geburtsdatum,
    alter,
    textFeld('herkunft_adresse', 'Herkunft / Adresse', PERSON_ANGABE_MAX, true),
    textFeld('antreff_ort', 'Fundort', PERSON_ANGABE_MAX),
    // Koordinate beschreibt eine angetroffene Person; „vermisst seit“ nur eine vermisste. Ein
    // offenes Feld bleibt, bis es schließt.
    ...(angetroffen || koordinate || 'Koordinate' in offen ? [koordinateAngabe] : []),
    ...(person.status === 'vermisst' || 'vermisst seit' in offen ? [vermisstSeit] : []),
    textFeld('melder_kontakt', 'Melder / Kontakt', PERSON_ANGABE_MAX, true),
    textFeld('notiz', 'Notiz', PERSON_NOTIZ_MAX, true),
  ];

  // Ein offenes Feld steht, wo es beim Öffnen stand (Spec `personendaten-bearbeiten`, „Eine
  // offene Bearbeitung zur Zeit“).
  const gesetzt = angaben.filter((a) =>
    a.etikett in offen ? offen[a.etikett] : !a.isLeer || (darfSchreiben && a.imRaster),
  );
  const ohne = angaben.filter((a) => !gesetzt.includes(a));
  // Ohne Schreibrecht steht die Koordinate leer nur mit Verorten-Weg im Raster; den gibt es ohne
  // Schreibrecht nicht.

  return (
    <div ref={behaelterRef} data-lfh="personendaten">
      {grund && (
        <div id={grundId} data-lfh="personendaten-grund" style={{ color: rollen.text2 }}>
          {grund}
        </div>
      )}
      {gesetzt.length > 0 && (
        <Datenraster spalten={2} beschriftung="Personendaten">
          {gesetzt.map((a) => (
            <Datenfeld key={a.etikett} label={a.etikett} mono={a.mono} breit={a.breit}>
              {darfSchreiben ? (
                a.zusatz ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: token.padding,
                    }}
                  >
                    {a.schreiben(false)}
                    {a.zusatz}
                  </div>
                ) : (
                  a.schreiben(false)
                )
              ) : (
                a.lesen
              )}
            </Datenfeld>
          ))}
        </Datenraster>
      )}
      {ohne.length > 0 &&
        (darfSchreiben ? (
          <div
            data-lfh="ohne-angabe"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              // Auch umgebrochen stehen die Knöpfe ≥ 8 / ≥ 16 px auseinander (Leitlinie, wie der
              // Dialogfuß: `padding` = 11/18/26 px); gemessen in `e2e/gate3-trefflaeche.spec.ts`.
              columnGap: token.padding,
              rowGap: token.padding,
              marginTop: token.marginXS,
            }}
          >
            <Typography.Text type="secondary">Ohne Angabe:</Typography.Text>
            {ohne.map((a) => (
              <div key={a.etikett} data-lfh="leere-angabe" style={{ minWidth: 0 }}>
                {a.schreiben(true)}
              </div>
            ))}
          </div>
        ) : (
          <Typography.Paragraph
            type="secondary"
            data-lfh="ohne-angabe"
            style={{ marginTop: 8, marginBottom: 0 }}
          >
            Ohne Angabe: {ohne.map((a) => a.etikett).join(', ')}
          </Typography.Paragraph>
        ))}
    </div>
  );
}
