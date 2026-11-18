import { Button, Typography } from 'antd';
import { useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import SichtungsTag from '../components/SichtungsTag';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { sprungGesperrtText } from '../components/Sprung';
import { Select } from '../components/Select';
import { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ladePerson, registrierAnzeige, savePersonFeld } from '../api/einsatzPerson';
import { OFFEN_LASSEN } from '../components/InlineAngabe';
import { useFeldKonflikt, VERWORFEN } from '../components/useFeldKonflikt';
import { fehlerText } from '../api/client';
import { PERSON_ZUSTAND_MAX } from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import { personDetailPfad } from '../routing/deeplinks';
import type { Person, PersonStatus } from '../api/types';
import { formatKalenderdatum } from '../anzeige/kalenderdatum';
import {
  SK_META,
  SK_REIHE,
  SK_WORT,
  STATUS_META,
  TRANSPORT_ART_WORT,
  transportRang,
} from './personMeta';
import PrioritaetMarke from './PrioritaetMarke';
import { kontamination } from '../theme/statusFarben';
import { GESCHLECHT_KURZ } from './personBefehl';
import { koordinatenText } from './koordinate';
import { nichtGeladen } from '../offline/lagebildKuerzung';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../offline/verbindung';
import type { PersonEintragArt } from '../offline/personEintrag';
import {
  istAngetroffen,
  lueckenText,
  lueckenVon,
  verbleibKlasse,
  verbleibLabel,
  type VerbleibKlasse,
} from './personenBilanz';
import ZeilenSichtung, { type ZeilenRueckmeldung } from './ZeilenSichtung';
import { Status } from '../components/instrument/Status';

/**
 * Das EINE Spaltenregister der Betroffenen-Listen; speist Zeilen- und Rasteransicht und über den
 * Kartenplan beide Darstellungsformen, auch am Gerät.
 *
 * Spalten: Nr. · Person (Name + Geschlecht/Alter, Marke „kontaminiert“) · Sichtung · Zustand ·
 * Status · Fundort · Verbleib · Transport · Vermerk · Zeit.
 *
 * Ohne `bedienung` ist alles Anzeige. Mit ihr bedient die Zeile (LLH-1130, Spec
 * `betroffene-lagedaten`, „Sichtung und Verbleib aus der Betroffenenliste“):
 * - „Sichtung“ ist der Auslöser der Nachsichtung (`ZeilenSichtung`, Popover mit Flächenwahl).
 * - „Zustand" ist inline bearbeitbar über `BemerkungZelle` (Zeilenkennung `R-042` im
 *   zugänglichen Namen, PATCH nur mit dem einen Feld).
 * Jede bedienbare Zelle fängt ihren Klick ab, sonst navigierte die Zeile per `onZeileKlick` auf
 * die Detailseite.
 * „Fundort" zeigt Freitext UND darunter die Koordinate in Mono; eine der beiden schließt die
 * Fundort-Lücke.
 *
 * Eine FABRIK, kein Wert: die Verbleib-Spalte braucht die UHS-Liste der Seite, die
 * Zustand-Spalte Einsatz und Schreibrecht. Durch `spaltenFuer<Person>()` geführt, NIE annotiert
 * — eine Annotation weitete die Schlüssel auf `string`, und der Kartenplan nähme Tippfehler an.
 *
 * Zweiter Kanal der Lückentönung: eine Zeile ohne Verbleib/Fundort trägt `lueckeZeile`; das
 * WORT („Verbleib offen") steht in der Personenzelle, weil nur sie in BEIDEN Zweigen steht.
 */

/** Alter-Anzeige: Geburtsdatum > geschätztes Alter (mit Tilde — das Feld IST geschätzt). */
function alterAnzeige(p: Pick<Person, 'geburtsdatum' | 'alter_geschaetzt'>): string | null {
  if (p.geburtsdatum) return formatKalenderdatum(p.geburtsdatum);
  if (p.alter_geschaetzt != null) return `~${p.alter_geschaetzt}`;
  return null;
}

/** „w ~34" — Geschlecht und Alter in der Kurzschreibweise der Erfassungszeile. */
export function geschlechtAlter(p: Person): string | null {
  const teile = [p.geschlecht ? GESCHLECHT_KURZ[p.geschlecht] : null, alterAnzeige(p)].filter(
    (t): t is string => t != null,
  );
  return teile.length > 0 ? teile.join(' ') : null;
}

/**
 * Der Zeitpunkt, seit dem eine Person in ihrem aktuellen Zustand ist — Grundlage der
 * Dringlichkeit. `aktuelle_sichtung_at` VOR `erfasst_at`; `geaendert_at` wäre falsch, es läuft
 * bei jeder Notiz weiter.
 */
export function seitWert(p: Person): string {
  return p.aktuelle_sichtung_at ?? p.erfasst_at;
}

/**
 * Namenstext einer Person, oder `null`. „unbekannt" gehört ins `render`, NICHT in den
 * Suchbeitrag — sonst träfe die Suche nach „unbekannt" jede namenlose Person.
 */
export function nameText(p: Pick<Person, 'name' | 'vorname'>): string | null {
  if (!p.name && !p.vorname) return null;
  return `${p.name ?? ''}${p.vorname ? `, ${p.vorname}` : ''}`;
}

/** Sichtung als `SichtungsTag` (BBK-Farbfeld, LFH-455), „—" wenn ungesichtet. */
export function SkTag({ p }: { p: Pick<Person, 'aktuelle_sichtung'> }) {
  return p.aktuelle_sichtung ? (
    <SichtungsTag kategorie={p.aktuelle_sichtung} />
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );
}

/** Personenzelle: Name 13 + Geschlecht/Alter Mono 11, darunter ggf. der Lückenvermerk. */
function PersonZelle({ p }: { p: Person }) {
  const { token, rollen } = useRollen();
  const ga = geschlechtAlter(p);
  const offen = lueckenText(lueckenVon(p));
  return (
    <div style={{ minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: token.marginXS }}>
        <span style={{ fontSize: 13, color: nameText(p) ? rollen.text : rollen.gedaempft }}>
          {nameText(p) ?? 'unbekannt'}
        </span>
        {ga && <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{ga}</span>}
        {/* Kontamination „ja“ als Marke (LLH-1326, design.md D11): Gefahr für die Kräfte, Rolle
            `achtung` mit Wort; „nein“ und „keine Angabe“ tragen keine. Die Personenzelle steht
            in Liste, Karte und Patientenliste am Gerät. */}
        {p.kontamination === true && <Status darstellung={kontamination} />}
      </span>
      {offen && (
        <div data-lfh="luecke" style={{ ...monoStil(11), color: rollen.achtungText }}>
          {offen}
        </div>
      )}
    </div>
  );
}

/** Ohne Netz liegt das Feld nicht vor (LFH-1095): weder leer noch offen. */
function NichtGeladenZelle() {
  const { rollen } = useRollen();
  return (
    <span data-lfh="nicht-geladen" style={{ fontSize: 12, color: rollen.gedaempft }}>
      nicht geladen
    </span>
  );
}

/** Offene Zelle in `achtung`, sonst neutraler Gedankenstrich. */
function Leerzelle({ offen }: { offen: boolean }) {
  const { rollen } = useRollen();
  return <span style={{ color: offen ? rollen.achtungText : rollen.schwach }}>—</span>;
}

function FundortZelle({ p }: { p: Person }) {
  const { rollen } = useRollen();
  const koordinate = koordinatenText(p);
  if (nichtGeladen(p, 'antreff_ort')) return <NichtGeladenZelle />;
  if (!p.antreff_ort && !koordinate) return <Leerzelle offen={lueckenVon(p).fundort} />;
  return (
    <div style={{ minWidth: 0 }}>
      {p.antreff_ort && <div style={{ fontSize: 12, color: rollen.text2 }}>{p.antreff_ort}</div>}
      {koordinate && (
        <div data-lfh="koordinate" style={{ ...monoStil(11), color: rollen.gedaempft }}>
          {koordinate}
        </div>
      )}
    </div>
  );
}

/** Transportpriorität als neutrale Marke, die Art dahinter; ohne Stand „—“ (LLH-1325). */
function TransportZelle({ p }: { p: Person }) {
  const { token, rollen } = useRollen();
  if (p.transport_prioritaet == null && p.transport_art == null) {
    return <span style={{ color: rollen.schwach }}>—</span>;
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: token.marginXS,
      }}
    >
      <PrioritaetMarke prioritaet={p.transport_prioritaet} />{' '}
      {p.transport_art && (
        <span style={{ fontSize: 12, color: rollen.text2 }}>
          {TRANSPORT_ART_WORT[p.transport_art]}
        </span>
      )}
    </span>
  );
}

/*
 * Sortieren und Filtern (LLH-1096, Spec `tabellen-sortieren-filtern`): Sichtung, Status, Verbleib
 * und (mit Abschnitten) Abschnitt filtern im Spaltenkopf; jede Spalte mit vergleichbarem Wert
 * sortiert. Zustand / Verdacht und Vermerk sind Freitext und bleiben ohne beides. Sichtung, Status
 * und Verbleib haben im Kartenzweig KEIN Auswahlfeld (`ohneKartenfeld`): jedes weitere Feld
 * schöbe am Handy die erste Karte aus dem ersten Bild (`e2e/betroffene-handy.spec.ts`), und die
 * Seite führt Status (Statusleiste) und Sichtung (Sichtungsraster) dort schon über der Liste.
 */

/** Wort mit großem Anfang für die Werteliste (wie die Statusleiste: „Erfasst“, LFH-963). */
const gross = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Sichtung in der Reihe der Dringlichkeit, „ohne Sichtung“ zuletzt. */
const OHNE_SICHTUNG = 'ohne';
const SICHTUNG_WERTE = [
  ...SK_REIHE.map((k) => ({ text: SK_META[k].label, value: k as string })),
  { text: SK_WORT.ohne, value: OHNE_SICHTUNG },
];

/** Die Status im Lebenslauf einer Person (erfasst … abgemeldet): Werteliste und Sortierachse. */
const STATUS_FOLGE = Object.keys(STATUS_META) as PersonStatus[];
const STATUS_WERTE = STATUS_FOLGE.map((s) => ({ text: gross(STATUS_META[s].label), value: s }));

/** Verbleib nach Klasse (nicht je UHS-Name): offen zuerst, dann vom Platz weg zum Ende. */
const VERBLEIB_FOLGE: readonly VerbleibKlasse[] = [
  'offen',
  'uhs',
  'unterwegs',
  'transport',
  'notunterkunft',
  'vor_ort',
  'entlassung',
  'verstorben',
];
const VERBLEIB_WERTE = VERBLEIB_FOLGE.map((k) => ({
  text: k === 'uhs' ? 'UHS' : k === 'offen' ? 'Offen' : gross(verbleibLabel(k)),
  value: k as string,
}));

/**
 * Der Abschnitt einer Person: der ihrer aktuellen UHS (LLH-1096). Eine Person trägt selbst keinen;
 * die Seite reicht ihn nur, wenn das Modul Einsatzabschnitte frei ist.
 */
export interface PersonenAbschnitt {
  name: (p: Person) => string | null;
  /** Die Abschnitte, an denen eine UHS hängt; ohne Werte kein Filter. */
  werte: readonly { text: string; value: string }[];
}

/** Bedienung der Zeilen; ohne sie bleibt das Register reine Anzeige. */
export interface PersonenBedienung {
  einsatzId: number;
  /** Schreibrecht im Einsatz: Zustand, Verbleib und Zeilenmenü. */
  darfSchreiben: boolean;
  /**
   * Sichten aus der Zeile. Vorgabe wie `darfSchreiben`; am Gerät `person-sichtung` (UHS ja,
   * Betreuungsstelle nein, LFH-1041).
   */
  darfSichten?: boolean;
  /** Zeilenfehler und Schleuse der Seite; ohne sie bleibt die Sichtung Anzeige. */
  rueckmeldung?: ZeilenRueckmeldung;
  /** Öffnet „Verbleib erfassen“ (Dialog der Seite); ohne den Weg bleibt der Verbleib Anzeige. */
  onVerbleib?: (p: Person) => void;
  /** Das Zeilenmenü (design.md D3); fehlt es, gibt es keine Aktionsspalte (Gerät). */
  menue?: PersonenZeilenMenue;
  /**
   * Ohne Netz vorgemerkte Einträge je Person (LLH-1138, `vorgemerktJePerson`): Sichtungs- und
   * Verbleib-Zelle zeigen „Offline vorgemerkt“, getrennt vom Serverstand.
   */
  vorgemerkt?: VorgemerktJePerson;
}

/** Arten vorgemerkter Einträge je Person. */
export type VorgemerktJePerson = ReadonlyMap<number, ReadonlySet<PersonEintragArt>>;

/** Die vorgemerkten Einträge eines Einsatzes nach Person; eine Liste liest sie einmal. */
export function vorgemerktJePerson(
  eintraege: readonly { aktion: { art: PersonEintragArt; person_id: number } }[],
): VorgemerktJePerson {
  const je = new Map<number, Set<PersonEintragArt>>();
  for (const { aktion } of eintraege) {
    const arten = je.get(aktion.person_id) ?? new Set<PersonEintragArt>();
    arten.add(aktion.art);
    je.set(aktion.person_id, arten);
  }
  return je;
}

/** Die Handlungen des Zeilenmenüs. */
export type PersonZeilenAktion = 'sichten' | 'verbleib' | 'uebergabe' | 'verorten';

export interface PersonenZeilenMenue {
  /** Breite der Aktionsspalte: Steuerhöhe der Dichte plus Zellpolster beidseits. */
  breite: number;
  /** Lagekarte für den Verortungsauftrag: frei, oder gesperrt mit Grund (LFH-888). */
  lagekarte: 'frei' | 'gesperrt';
  onWahl: (aktion: PersonZeilenAktion, p: Person) => void;
}

/** Wortlaut des Verortungsauftrags, wie auf der Detailseite. */
const VERORTEN = 'Auf Lagekarte verorten';

/**
 * Die Einträge des Zeilenmenüs einer Person (LLH-1130, design.md D3): „Sichten“, bei einem
 * Patienten im Eigentransport „Übergabe quittieren“ (LLH-1332), „Verbleib erfassen“, „Auf
 * Lagekarte verorten“. Nur für eine angetroffene, nicht stornierte Person und nur
 * mit Schreibrecht; eine gesperrte Lagekarte steht gesperrt mit Grund da (M16). Gebündelt wird ab
 * drei Einträgen (`frontend/AGENTS.md`, „Datensatz-Aktionen werden gebündelt“); darunter gibt es
 * kein Menü, Sichtung und Verbleib bleiben in ihren Zellen.
 */
export function zeilenMenueEintraege(
  p: Person,
  bedienung: PersonenBedienung | undefined,
): MenueEintrag<PersonZeilenAktion>[] {
  const menue = bedienung?.menue;
  if (!menue || !bedienung.darfSchreiben || !istAngetroffen(p) || p.storniert_at) return [];
  const eintraege: MenueEintrag<PersonZeilenAktion>[] = [
    ...((bedienung.darfSichten ?? bedienung.darfSchreiben)
      ? [{ key: 'sichten' as const, label: 'Sichten' }]
      : []),
    // Ein Eigentransport endet mit der quittierten Übergabe (LLH-1332, design.md D6).
    ...(bedienung.onVerbleib && p.versorgung === 'unterwegs'
      ? [{ key: 'uebergabe' as const, label: 'Übergabe quittieren' }]
      : []),
    ...(bedienung.onVerbleib ? [{ key: 'verbleib' as const, label: 'Verbleib erfassen' }] : []),
    menue.lagekarte === 'gesperrt'
      ? { key: 'verorten', label: sprungGesperrtText(VERORTEN), gesperrt: true }
      : { key: 'verorten', label: VERORTEN },
  ];
  return eintraege.length >= 3 ? eintraege : [];
}

/** Zugänglicher Name des Menüauslösers, mit Kennung (mehrere Menüs auf einer Seite). */
export function zeilenMenueName(p: Pick<Person, 'registrier_nr'>): string {
  return `Aktionen zu ${registrierAnzeige(p.registrier_nr)}`;
}

/** Spaltenkopf ohne Beschriftung, aber mit Namen für die Hilfstechnik. */
const NUR_VORGELESEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

/** Ist die Sichtung dieser Zeile bedienbar? Nur eine angetroffene, nicht stornierte Person. */
function isSichtungBedienbar(p: Person, b: PersonenBedienung | undefined): boolean {
  return (
    b?.rueckmeldung != null &&
    (b.darfSichten ?? b.darfSchreiben) &&
    istAngetroffen(p) &&
    !p.storniert_at
  );
}

/** Der Zustand als Wire-Wert: leer oder nur Leerraum ist `null`. */
const alsZustand = (z: string): string | null => (z.trim() === '' ? null : z);

/**
 * Schreibzweig der Zustand-Zelle: PATCH mit NUR `zustand` (`savePersonFeld`), also wird kein
 * anderes Feld geleert. Feld-CAS (LLH-1945, Entscheidung 18.11.2026): auch dieses Kurzfeld prüft
 * auf zwischenzeitliche Änderung. Der Zustand beim Öffnen der Zelle (`onOeffnen`) geht als Altwert
 * mit; hat ein anderer ihn inzwischen geändert, fragt `useFeldKonflikt` „Zwischenzeitlich
 * geändert“. „Meine Änderung übernehmen“ schreibt ohne Altwert; „Verwerfen“, Escape und Schließen
 * schreiben nichts, die Zelle zeigt den frischen Stand ohne Fehler (das Feld ist dann schon zu).
 *
 * - Während der Mutation zeigt die Zelle den GETIPPTEN Wert mit Ladeanzeige (`variables`).
 * - `onSuccess` gibt die Invalidierung ZURÜCK: react-query hält `isPending`, bis der neue Stand
 *   in der Liste steht — sonst spränge der Wert eine Runde lang auf den alten zurück.
 * - Ein Fehler steht AN DER ZELLE (`data-fehler`, Rand aus `colorError`, Satz in `alarmText`),
 *   kein Toast. Er geht beim nächsten Versuch von selbst. Während der Rückfrage steht er nicht.
 */
export function ZustandSchreiben({ p, einsatzId }: { p: Person; einsatzId: number }) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  // Ohne Verbindung gesperrt mit Grund, im Kopf wie in der Liste (LLH-1103, design.md D8): die
  // Mutation pausierte sonst und überschriebe nach der Rückkehr still einen ungesehenen Wert.
  // `useOhneVerbindung`, nie `navigator.onLine` allein (WLAN ohne Server).
  const ohneVerbindung = useOhneVerbindung();
  const konflikt = useFeldKonflikt();
  const mutation = useMutation({
    mutationFn: (v: { zustand: string; erwartet?: string | null }) =>
      savePersonFeld(einsatzId, p.id, 'zustand', alsZustand(v.zustand), v.erwartet),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) }),
        qc.invalidateQueries({ queryKey: einsatzKeys.person(einsatzId, p.id) }),
      ]),
  });
  // Der Zustand beim Öffnen der Zelle: Altwert des Feld-CAS, fest bis zum nächsten Öffnen.
  const beimOeffnen = useRef<string | null>(p.zustand ?? null);
  // Solange die Rückfrage klärt, ist der 409 der ersten Anfrage kein Fehler an der Zelle.
  const [klaert, setKlaert] = useState(false);
  const save = async (zustand: string) => {
    setKlaert(true);
    const ergebnis = await konflikt({
      etikett: 'Zustand / Verdacht',
      erwartet: alsZustand(beimOeffnen.current ?? ''),
      speichern: async (erwartet) => {
        await mutation.mutateAsync({ zustand, erwartet });
      },
      ladeFrisch: async () => {
        const frisch = await qc.fetchQuery({
          queryKey: einsatzKeys.person(einsatzId, p.id),
          queryFn: () => ladePerson(einsatzId, p.id),
          staleTime: 0,
        });
        // Die Liste zeigt danach den frischen Stand.
        void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
        return frisch;
      },
      aktuell: (frisch) => ({ wert: alsZustand(frisch.zustand ?? '') }),
      text: (w) => w ?? '',
    }).finally(() => setKlaert(false));
    // Nichts geschrieben: der 409 der ersten Anfrage ist kein Fehler an der Zelle.
    if (ergebnis === VERWORFEN || ergebnis === OFFEN_LASSEN) mutation.reset();
  };
  const laeuft = mutation.isPending;
  const fehler = mutation.isError && !klaert ? fehlerText(mutation.error, 'Grund unbekannt') : null;
  return (
    <div
      data-lfh="zustand-zelle"
      data-fehler={fehler ? 'true' : undefined}
      style={
        fehler
          ? {
              borderInlineStart: `3px solid ${token.colorError}`,
              paddingInlineStart: token.paddingXS,
            }
          : undefined
      }
    >
      <BemerkungZelle
        wert={laeuft ? mutation.variables?.zustand : p.zustand}
        laeuft={laeuft}
        darfSchreiben
        bezeichnung="Zustand / Verdacht"
        kennung={registrierAnzeige(p.registrier_nr)}
        max={PERSON_ZUSTAND_MAX}
        gesperrt={ohneVerbindung ? OHNE_VERBINDUNG_NICHT_AENDERBAR : undefined}
        onOeffnen={() => {
          beimOeffnen.current = p.zustand ?? null;
        }}
        // Ohne Zusage: die Zelle schließt sofort und zeigt den getippten Wert mit Ladeanzeige
        // (LFH-650); ein Fehler steht an der Zelle, die Rückfrage kommt als Dialog.
        onSpeichern={(wert) => {
          save(wert).catch(() => undefined);
        }}
      />
      {fehler && (
        <div role="alert" style={{ fontSize: 12, color: rollen.alarmText }}>
          Nicht gespeichert: {fehler}
        </div>
      )}
    </div>
  );
}

function ZustandZelle({ p, bedienung }: { p: Person; bedienung?: PersonenBedienung }) {
  const { rollen } = useRollen();
  // Nicht bearbeitbar: eine pausierte Änderung überschriebe nach der Rückkehr des Netzes einen
  // Wert, den niemand gesehen hat (LFH-1095).
  if (nichtGeladen(p, 'zustand')) return <NichtGeladenZelle />;
  // Der Zustand beschreibt eine ANGETROFFENE Person — einer vermissten wird er nicht angeboten.
  if (!bedienung?.darfSchreiben || !istAngetroffen(p)) {
    return p.zustand ? (
      <span style={{ fontSize: 12, color: rollen.text2 }}>{p.zustand}</span>
    ) : (
      <span style={{ color: rollen.schwach }}>—</span>
    );
  }
  return (
    // Der Klick gehört der Zelle, sonst navigierte die Zeile zusätzlich auf die Detailseite
    // (`onZeileKlick` greift nur Anker ab).
    <div onClick={(e) => e.stopPropagation()}>
      <ZustandSchreiben p={p} einsatzId={bedienung.einsatzId} />
    </div>
  );
}

/** Verbleib-Anzeige: Kurzform (sonst Wort) der Art, sonst die aktuelle UHS, sonst „—". */
export function verbleibText(
  p: Pick<
    Person,
    'aktuelle_verbleib_art' | 'aktueller_verbleib' | 'aktuelle_uhs_id' | 'versorgung'
  >,
  uhsName: (id: number) => string | undefined,
): string | null {
  const k = verbleibKlasse(p);
  if (k === 'offen') return null;
  if (k === 'uhs') return `UHS ${uhsName(p.aktuelle_uhs_id!) ?? ''}`.trim();
  // Fehlt die Kurzform, steht das Wort der Art — sonst zeigte eine Person MIT Verbleib „—" und
  // keine Lücke.
  return p.aktueller_verbleib || verbleibLabel(k);
}

/**
 * Verbleib-Zelle. Bei offenem Verbleib einer angetroffenen Person steht dort „Verbleib erfassen“
 * (LLH-1130, design.md D2): die Lücke schließt in der Zelle, in der sie steht, auch unter „Nur
 * Lücken zeigen“. Der Knopf öffnet den Dialog der Seite (`VerbleibErfassung`, Fehler im Dialog).
 */
function VerbleibZelle({
  p,
  uhsName,
  bedienung,
}: {
  p: Person;
  uhsName: (id: number) => string | undefined;
  bedienung?: PersonenBedienung;
}) {
  const { rollen } = useRollen();
  const text = verbleibText(p, uhsName);
  // Ein vorgemerkter Verbleib (LLH-1138) steht neben dem Serverstand, nicht an seiner Stelle.
  const vorgemerkt = bedienung?.vorgemerkt?.get(p.id)?.has('verbleib') && (
    <div data-lfh="zeile-vorgemerkt" style={{ fontSize: 12, color: rollen.text2 }}>
      Offline vorgemerkt
    </div>
  );
  if (vorgemerkt) {
    return (
      <>
        {text != null && <span style={{ fontSize: 12, color: rollen.text2 }}>{text}</span>}
        {vorgemerkt}
      </>
    );
  }
  if (text != null) return <span style={{ fontSize: 12, color: rollen.text2 }}>{text}</span>;
  const offen = lueckenVon(p).verbleib;
  const onVerbleib = bedienung?.darfSchreiben && !p.storniert_at ? bedienung.onVerbleib : undefined;
  if (!offen || !onVerbleib) return <Leerzelle offen={offen} />;
  return (
    <Button
      type="link"
      aria-label={`Verbleib erfassen für ${registrierAnzeige(p.registrier_nr)}`}
      // Der Klick gehört der Zelle, sonst öffnete die Zeile die Detailseite.
      onClick={(e) => {
        e.stopPropagation();
        onVerbleib(p);
      }}
      style={{ paddingInline: 0 }}
    >
      Verbleib erfassen
    </Button>
  );
}

export function personenSpalten(
  uhsName: (id: number) => string | undefined,
  bedienung?: PersonenBedienung,
  abschnitt?: PersonenAbschnitt,
) {
  return spaltenFuer<Person>()([
    {
      title: 'Nr.',
      key: 'reg',
      width: 84,
      immerSichtbar: true,
      zahl: true,
      // Sortiert wird über die ZAHL — über den Anzeigetext läge „R-10" vor „R-9".
      sortWert: (p) => p.registrier_nr,
      // Die PAT-Nummer gehört zur Kennung der Person (LLH-1326, design.md D12): „4711“ findet
      // „A-4711“. Ohne Netz fehlt sie im gekürzten Datensatz, dann trifft nur die Nr.
      suchText: (p) => [registrierAnzeige(p.registrier_nr), p.pat_nummer].filter(Boolean).join(' '),
      // KEIN Anker hier: den Titel-Link setzt der Kartenplan über `titel.ziel`. Ohne Umbruch: in
      // der Handschuh-Dichte brach „R-001“ sonst in „R-“ / „001“ (LFH-1151).
      render: (_, p) => (
        <span style={{ whiteSpace: 'nowrap' }}>{registrierAnzeige(p.registrier_nr)}</span>
      ),
    },
    {
      title: 'Person',
      key: 'person',
      mindestBreite: 180,
      sortWert: (p) => nameText(p),
      suchText: nameText,
      render: (_, p) => <PersonZelle p={p} />,
    },
    {
      title: 'Sichtung',
      key: 'sk',
      width: 104,
      // In der Reihe der Dringlichkeit (`SK_REIHE`), ohne Sichtung hinten.
      sortWert: (p) => (p.aktuelle_sichtung ? SK_REIHE.indexOf(p.aktuelle_sichtung) : null),
      filter: {
        werte: SICHTUNG_WERTE,
        trifft: (p, w) => (p.aktuelle_sichtung ?? OHNE_SICHTUNG) === w,
        ohneKartenfeld: true,
      },
      render: (_, p) =>
        bedienung?.rueckmeldung && isSichtungBedienbar(p, bedienung) ? (
          <ZeilenSichtung
            p={p}
            einsatzId={bedienung.einsatzId}
            rueckmeldung={bedienung.rueckmeldung}
            vorgemerkt={bedienung.vorgemerkt?.get(p.id)?.has('sichtung')}
          />
        ) : (
          <SkTag p={p} />
        ),
    },
    {
      title: 'Zustand / Verdacht',
      key: 'zustand',
      // Feste Breite mit Platz für den Platzhalter-Knopf — KEINE weitere Fließspalte neben Person
      // und Vermerk.
      width: 140,
      // Weder Sortierung noch Filter (LLH-1096): Freitext ist kein Vergleichswert.
      suchText: (p) => p.zustand,
      render: (_, p) => <ZustandZelle p={p} bedienung={bedienung} />,
    },
    {
      title: 'Status',
      key: 'status',
      width: 118,
      sortWert: (p) => STATUS_FOLGE.indexOf(p.status),
      filter: { werte: STATUS_WERTE, trifft: (p, w) => p.status === w, ohneKartenfeld: true },
      render: (_, p) => <Status darstellung={STATUS_META[p.status]} />,
    },
    {
      title: 'Fundort',
      key: 'fundort',
      abBreite: 'lg',
      // Weder Sortierung noch Filter (LLH-1096): Freitext samt Koordinate, kein Vergleichswert.
      suchText: (p) => [p.antreff_ort, koordinatenText(p)].filter(Boolean).join(' ') || null,
      render: (_, p) => <FundortZelle p={p} />,
    },
    {
      title: 'Verbleib',
      key: 'verbleib',
      sortWert: (p) => verbleibText(p, uhsName),
      filter: {
        werte: VERBLEIB_WERTE,
        trifft: (p, w) => verbleibKlasse(p) === w,
        ohneKartenfeld: true,
      },
      suchText: (p) => verbleibText(p, uhsName),
      render: (_, p) => <VerbleibZelle p={p} uhsName={uhsName} bedienung={bedienung} />,
    },
    ...(abschnitt
      ? [
          {
            // Lesend und erst ab `xxl` (wie im Personal, LLH-1096): Person und Vermerk fließen,
            // eine weitere Spalte nähme ihnen am Fükw die Breite. Über den Spaltenschalter zurück.
            title: 'Abschnitt',
            key: 'abschnitt' as const,
            width: 130,
            abBreite: 'xxl' as const,
            sortWert: (p: Person) => abschnitt.name(p),
            filter:
              abschnitt.werte.length > 0
                ? {
                    werte: abschnitt.werte,
                    trifft: (p: Person, w: string) => abschnitt.name(p) === w,
                  }
                : undefined,
            render: (_: unknown, p: Person) => abschnitt.name(p) ?? <Leerzelle offen={false} />,
          },
        ]
      : []),
    {
      title: 'Transport',
      key: 'transport',
      // Feste Breite (LFH-523): neben Person und Vermerk fließt keine weitere Spalte. Ab `lg`,
      // wie der Fundort; darunter trägt die Sichtung die Folge.
      width: 112,
      abBreite: 'lg',
      // Der Rang der Priorität (LLH-1325, design.md D10); ohne Priorität leer, also hinten.
      sortWert: (p) =>
        p.transport_prioritaet == null ? null : transportRang(p.transport_prioritaet),
      suchText: (p) =>
        [p.transport_prioritaet, p.transport_art && TRANSPORT_ART_WORT[p.transport_art]]
          .filter(Boolean)
          .join(' ') || null,
      render: (_, p) => <TransportZelle p={p} />,
    },
    {
      title: 'Vermerk',
      key: 'vermerk',
      abBreite: 'xxl',
      mindestBreite: 160,
      // Weder Sortierung noch Filter (LLH-1096): eine Notiz in Freitext ist kein Vergleichswert.
      suchText: (p) => p.notiz,
      render: (_, p) =>
        nichtGeladen(p, 'notiz') ? (
          <NichtGeladenZelle />
        ) : p.notiz ? (
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: p.notiz }}
            style={{ fontSize: 12 }}
          >
            {p.notiz}
          </Typography.Text>
        ) : null,
    },
    {
      title: 'Zeit',
      key: 'seit',
      width: 88,
      align: 'right',
      zahl: true,
      /**
       * Rolle „kurz“ statt reiner Uhrzeit: ein Einsatz dauert über Mitternacht — heute `1430`,
       * sonst `091430` (LLH-1061). Den Tageswechsel zeichnet `Datensicht` nach (`viertelstunde`).
       */
      sortWert: seitWert,
      render: (_, p) => <ZeitAnzeige wert={seitWert(p)} rolle="kurz" />,
    },
    /*
     * Die Aktionsspalte (design.md D3): schmal, feste Breite, ohne Beschriftung, nicht abwählbar.
     * Öffnen bleibt der Zeilenklick; der Auslöser fängt seinen Klick ab. Unter `md` trägt der
     * Kartenfuß dasselbe Menü (`weitere` des Kartenplans).
     */
    ...(bedienung?.menue
      ? [
          {
            title: <span style={NUR_VORGELESEN}>Aktionen</span>,
            etikett: 'Aktionen',
            key: 'aktionen' as const,
            width: bedienung.menue.breite,
            immerSichtbar: true,
            // Ab `md` rechts fixiert, die Aktion bleibt ohne Querscrollen im Bild (LLH-1789).
            amEnde: true as const,
            render: (_: unknown, p: Person) => (
              <ZeilenMenue p={p} bedienung={bedienung} menue={bedienung.menue!} />
            ),
          },
        ]
      : []),
  ]);
}

function ZeilenMenue({
  p,
  bedienung,
  menue,
}: {
  p: Person;
  bedienung: PersonenBedienung;
  menue: PersonenZeilenMenue;
}) {
  const hold = bedienung.rueckmeldung?.hold;
  return (
    // Der Auslöser reicht seinen Klick weiter (`MenueAusloeser`); hier endet er, sonst öffnete die
    // Zeile die Detailseite.
    <div onClick={(e) => e.stopPropagation()}>
      <MenueAusloeser<PersonZeilenAktion>
        eintraege={zeilenMenueEintraege(p, bedienung)}
        zugaenglicherName={zeilenMenueName(p)}
        onWahl={(aktion) => menue.onWahl(aktion, p)}
        onOffenAenderung={hold ? (offen) => hold(`menue:${p.id}`, offen) : undefined}
      />
    </div>
  );
}

/** Die Schlüsselmenge des Registers — Grundlage jedes typgeprüften Kartenplan-Slots. */
export type PersonenSpaltenKey = ReturnType<typeof personenSpalten>[number]['key'];

/**
 * Der Rückgabetyp ist der Plan-ZWEIG, nicht der ganze `Kartenplan`-Verbund: über dem
 * Verbund verlöre `{ ...personenKarte(id), aktion: … }` die Unterscheidung nach `art`.
 */
type KartenPlanZweig<T, K extends string> = Extract<Kartenplan<T, K>, { art: 'plan' }>;

/**
 * Kartenplan: Nr. als Titel-Link, Personenstatus im Status-Slot, Person (samt Lückenvermerk),
 * Sichtung und Zeit als Sekundärfelder.
 */
export const personenKarte = (einsatzId: number): KartenPlanZweig<Person, PersonenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (p) => personDetailPfad(einsatzId, p.id) },
  status: (p) => STATUS_META[p.status],
  sekundaer: ['person', 'sk', 'seit'],
});

/**
 * Zusatzspalte „Abgleich vorschlagen" (nur Vermisst-Filter mit Schreibrecht). Im Kartenzweig
 * ersetzt ein Knopf plus Dialog das Auswahlfeld, das auf 390 px nicht trägt.
 */
export function abgleichSpalten(
  gefundene: readonly Person[],
  onAbgleich: (vermisstId: number, gefundenId: number) => void,
) {
  return spaltenFuer<Person>()([
    {
      title: 'Abgleich vorschlagen',
      key: 'abgleich',
      width: 220,
      immerSichtbar: true,
      render: (_: unknown, v: Person) => (
        // Der Klick gehört der Zelle, sonst navigierte die Zeile auf die Detailseite. Die Hülle
        // fängt auch die Wahl im Auswahlmenü: React reicht Klicks aus dem Portal durch den Baum.
        <div onClick={(e) => e.stopPropagation()}>
          <Select<number>
            placeholder="gefundene Person …"
            style={{ width: 200 }}
            onChange={(gid) => onAbgleich(v.id, gid)}
            options={gefundene.map((g) => ({
              value: g.id,
              label: `${registrierAnzeige(g.registrier_nr)} ${g.name ?? 'unbekannt'}`,
            }))}
            disabled={gefundene.length === 0}
          />
        </div>
      ),
    },
  ]);
}
