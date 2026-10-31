import type { FachebeneQuelle } from './fachebenen';
import type { AbloesungStatus, EtbTyp } from './types';
import type { SchaedenFilter, SchadenSortierung } from './einsatzSchaden';

/**
 * Query-Key-Registry (LFH-122/307) mit zwei Hälften: `einsatzKeys` für alles unter einer
 * `einsatzId` und `globalKeys` für alles darüber (Mandant, Stammdaten-Kataloge, Instanz,
 * externe Quellen).
 *
 * `useEinsatzLiveStream` leitet Listener, Invalidierung UND den lagged-Vollabgleich aus
 * {@link EINSATZ_STREAM_EVENTS} ab, die Org-Ereignisse und den Org-Abgleich aus
 * {@link ORG_STREAM_EVENTS}/{@link ORG_LIVE_KEYS} (`live/orgListener.ts`, LFH-734); ein neues
 * Live-Modul ist EIN Eintrag hier. `queryKeys.guard.test.ts` verlangt, dass Prefixe nur hier als Literal vorkommen und
 * kein Inline-String-Array als Query-Key dient.
 */

/** Query-Key-Prefixe (erstes Element eines `[prefix, einsatzId, …]`-Keys). */
export const EINSATZ_KEYS = {
  uhs: 'einsatz-uhs',
  schaeden: 'einsatz-schaeden',
  // Fotos und Dateien an einem Schaden: eigener Prefix neben der Schadensliste, live über das
  // `schaden`-Ereignis.
  schadenAnhaenge: 'einsatz-schaden-anhaenge',
  // Schadenmarker für Lagekarte und Lage-Dashboard (LFH-931): schlanke Projektion ohne
  // Freitexte, eigener Prefix neben der Schadenliste, live über `schaden`.
  schadenMarker: 'einsatz-schaden-marker',
  // LFH-758: dasselbe an Tieren und UHS, live über `tier` bzw. `uhs`.
  tierAnhaenge: 'einsatz-tier-anhaenge',
  uhsAnhaenge: 'einsatz-uhs-anhaenge',
  // Zugriffsprotokoll der UHS-Dateien (nur Einsatzleitung), bewusst nicht live.
  uhsAnhangZugriffe: 'einsatz-uhs-anhang-zugriffe',
  fahrzeuge: 'einsatz-fahrzeuge',
  material: 'einsatz-material',
  tiere: 'einsatz-tiere',
  zonen: 'einsatz-zonen',
  freieZeichen: 'einsatz-freie-zeichen',
  gefahrengebiete: 'gefahrengebiete',
  gefahrenmatrix: 'gefahrenmatrix',
  einheiten: 'einsatz-einheiten',
  // Vorschau einer Einheiten-Vorlage im Einsatz (LLH-1049): eigener Prefix, damit sie NICHT mit
  // den Einheiten auf die Platte geht (Bilden nur mit Server); live über einheit/fahrzeug/personal.
  einheitAusVorlage: 'einsatz-einheit-aus-vorlage',
  fuehrungskraefte: 'einsatz-fuehrungskraefte',
  personal: 'einsatz-personal',
  abschnitte: 'einsatz-abschnitte',
  personen: 'einsatz-personen',
  // Personenauswahl ohne Freitexte (LFH-940): Picker, Sprungpalette, Chat-Bezug. Eigener Prefix,
  // live über `person`; im Lagebild offline wie die Vollliste (design.md D8).
  personenAuswahl: 'einsatz-personen-auswahl',
  lageberichte: 'einsatz-lageberichte',
  lagebericht: 'einsatz-lagebericht',
  // Bild-Anlagen (LFH-1028): eigener Prefix, live über `lagebericht` mit `anlagen`.
  lageberichtAnlagen: 'einsatz-lagebericht-anlagen',
  chatKanaele: 'einsatz-chat-kanaele',
  chatNachrichten: 'einsatz-chat-nachrichten',
  erinnerungen: 'einsatz-erinnerungen',
  auftraege: 'einsatz-auftraege',
  nachforderungen: 'einsatz-nachforderungen',
  // Übliche Arten der Organisation (LLH-1379): eigener Prefix, nicht live (zählt andere
  // Einsätze; ein Sub-Key unter `nachforderungen` holte sie bei jedem Ereignis neu) und nicht im
  // Lagebild offline (Wortlaut anderer Einsätze gehört nicht auf die Platte).
  nachforderungArten: 'einsatz-nachforderung-arten',
  meldungen: 'einsatz-meldungen',
  lagemeldungen: 'einsatz-lagemeldungen',
  br: 'einsatz-br',
  brDetail: 'einsatz-br-detail',
  // Verlauf eines Raums (LLH-1095): eigener Prefix, lädt erst beim Aufklappen; live über
  // `bereitstellungsraum`, nicht auf der Platte.
  brVerlauf: 'einsatz-br-verlauf',
  // Erwartete Kräfte aus Nachforderungen mit Ziel = Raum (LLH-1387): eigener Prefix, lädt nur im
  // offenen Dialog „Eintreffen buchen“; live über `nachforderung` (Führung) und
  // `bereitstellungsraum` (eine Buchung am Gerät), nicht auf der Platte.
  brErwartet: 'einsatz-br-erwartet',
  // Stamm-Treffer zum Raum (LLH-1300): Einheiten-Vorlagen je Suchtext, lädt nur im offenen Dialog
  // „Eintreffen buchen“ ab drei Zeichen; live über `bereitstellungsraum` (eine Buchung bildet eine
  // Einheit, die dann kein Treffer mehr ist), nicht auf der Platte.
  brStammTreffer: 'einsatz-br-stamm-treffer',
  kartenbilder: 'einsatz-kartenbilder',
  etb: 'etb',
  befehle: 'einsatz-befehle',
  befehl: 'einsatz-befehl',
  befehlAnlagen: 'einsatz-befehl-anlagen',
  kartenAnsicht: 'einsatz-karten-ansicht',
  lageSnapshot: 'einsatz-lage-snapshot',
  stab: 'einsatz-stab',
  // Lagebesprechung (LLH-1111): Stand und Verlauf unter EINEM Prefix, eigenes Ereignis.
  lagebesprechung: 'einsatz-lagebesprechung',
  // Fernmeldewesen (LLH-1180): Kommunikationsplan und Skizze unter EINEM Prefix, eigenes Ereignis.
  fernmeldewesen: 'einsatz-fernmeldewesen',
  // Modulzähler des Navigationsrahmens: hängt an jedem Ereignis, das die Liste eines gezählten
  // Moduls invalidiert (Vollständigkeit: `queryKeys.test.ts`).
  modulZaehler: 'einsatz-modul-zaehler',
  // Verdichtetes Lagebild des Lagemonitors (LFH-892): Zahlen ohne Personenbezug. Personen-
  // Ereignisse erreichen den Monitor nicht; er holt die Zahlen zusätzlich im Takt.
  lagemonitor: 'einsatz-lagemonitor',
  dokumente: 'einsatz-dokumente',
  abloesungen: 'einsatz-abloesungen',
  // Kräfte-Zeitachse (LFH-552): Perioden je Einheit/Person und Zeitachse einer Kraft unter EINEM
  // Prefix. Kein eigenes Live-Ereignis — jedes Ereignis entsteht in einer Transaktion, die
  // `einheit`, `personal`, `fahrzeug` oder `abloesung` ohnehin sendet.
  kraefteZeitachse: 'einsatz-kraefte-zeitachse',
  betreuung: 'einsatz-betreuung',
  // Evakuierungsbezirke (LLH-1034): eigenes Modul neben der Betreuung, eigener Prefix.
  evakuierung: 'einsatz-evakuierung',
  verpflegung: 'einsatz-verpflegung',
  // Presse- und Medienarbeit S5 (LFH-554): Presse-Log und Pressemitteilungen unter EINEM Prefix,
  // das Informationstelefon unter einem eigenen. Beide NICHT im Lagebild offline (Personenbezug).
  presse: 'einsatz-presse',
  infotelefon: 'einsatz-infotelefon',
  // Einsatzkopf, live über das `einsatz`-Ereignis (LFH-555).
  einsatz: 'einsatz',
  // Eigene Führungsstelle (LFH-849): eigener Endpunkt, live über dasselbe `einsatz`-Ereignis.
  fuehrungsstelle: 'einsatz-fuehrungsstelle',
  // Nicht live über SSE getrieben (siehe NICHT_LIVE_KEYS + Guard-Test):
  einstellungen: 'einsatz-einstellungen',
  mitglieder: 'einsatz-mitglieder',
  // Personen, die die Einsatzleitung aufnehmen kann (LFH-1141): eigener Prefix, damit die
  // Klassifizierung je Prefix eindeutig bleibt; Schreiben im Zugriff invalidiert beide.
  mitgliedAuswahl: 'einsatz-mitglieder-auswahl',
  sprechgruppen: 'einsatz-sprechgruppen',
  modulOverrides: 'einsatz-modul-overrides',
  // Modul-Vorgaben der Einsatz-Org (LLH-1183), für den Editor „Module“.
  modulVorgaben: 'einsatz-modul-vorgaben',
  // Gerätekopplungen der Einsatzleitung (LFH-892).
  geraete: 'einsatz-geraete',
  // Effektive Modulfreigaben des angemeldeten Benutzers (LFH-669); daraus liest das Modul-Gate.
  modulFreigaben: 'einsatz-modul-freigaben',
  // Verlauf der eigenen Benachrichtigungen samt ungelesenen Eingängen (LLH-1143): Knopf
  // „Eingänge“, Tab-Titel und App-Badge lesen denselben Key.
  benachrichtigungVerlauf: 'einsatz-benachrichtigung-verlauf',
  // Vorgabe je Funktion am Einsatz (LLH-1421), live über das `einsatz`-Ereignis.
  benachrichtigungVorgaben: 'einsatz-benachrichtigung-vorgaben',
  ortVorschau: 'ort-vorschau',
  // Auf dem Gerät dekodierte HEIC-Vorschau eines Anhangs (LFH-759): Object-URLs, die
  // `erzeugeQueryClient` beim Verlassen des Caches freigibt.
  anhangHeicVorschau: 'einsatz-anhang-heic-vorschau',
  // Adresssuche der Lagekarte (LFH-638): Suchtext → Treffer des Geocoders.
  ortSuche: 'ort-suche',
  // Ortssuche des Ortsfelds im Einsatz (LFH-1175): andere Route, eigenes Fach.
  einsatzortSuche: 'einsatzort-suche',
  // Singular-Detail-Keys: der SSE-Fan-out invalidiert die Listen-Prefixe, nicht diese (eigenes
  // erstes Element, kein Prefix-Match). Bewusst NICHT_LIVE.
  uhsDetail: 'einsatz-uhs-detail',
  // Plan einer UHS (LFH-999): Object-URL des Bildes, Key mit sha256. Eigener Prefix statt
  // Sub-Key des Details: das `uhs`-Ereignis invalidiert das Detail, ein Sub-Key lüde das
  // unveränderte Bild bei jedem Ereignis neu.
  uhsPlanBild: 'einsatz-uhs-plan-bild',
  person: 'einsatz-person',
  personAudit: 'einsatz-person-audit',
  // Zugriffe auf die ganze Personenliste (LFH-916): eigener Prefix, unter `personen` zöge ihn
  // jedes `person`-Ereignis per Präfix mit.
  personenListenzugriffe: 'einsatz-personen-listenzugriffe',
  // Auswahl „Bestätigt von“ am UHS-Gerät (LFH-1046): eigener Prefix, unter `personen` zöge ihn
  // jedes `person`-Ereignis mit; das Personal liefert dem Gerät kein Ereignis.
  personenBestaetiger: 'einsatz-personen-bestaetiger',
  // Vorschläge zum Rettungsmittel der Verbleib-Maske (LLH-1332): eigener Prefix, live über
  // `person` (bisher verwendete) und `fahrzeug` (Fahrzeuge im Einsatz).
  personenTransportmittel: 'einsatz-personen-transportmittel',
  // Fotos und Dateien an einer Person (LFH-757): live über das `person`-Ereignis. Nicht im
  // Lagebild offline (Patientenfotos und ihre Dateinamen bleiben vom Gerät fern, LFH-767).
  personAnhaenge: 'einsatz-person-anhaenge',
  tier: 'einsatz-tier',
  schaden: 'einsatz-schaden',
  // Snapshot-Dokument: eigener Prefix, damit die Listen-Invalidierung (`lage_snapshot`) die
  // unveränderlichen Dokumente nicht per Prefix mit-refetcht.
  lageSnapshotDokument: 'einsatz-lage-snapshot-dokument',
  // Maßgebliche Pegel mit Messung: kein Live-Event, 5-min-Nachfrage.
  pegel: 'einsatz-pegel',
  // Wetter am Einsatzort: DWD-Warnungen + Vorhersage, kein Live-Event.
  wetter: 'einsatz-wetter',
  // ETB-Druckansicht: Schnappschuss, eigener Prefix außerhalb von `etb`.
  etbDruck: 'einsatz-etb-druck',
  // Druck der Modul-Listen (LFH-727): Schnappschüsse, eigene Prefixe außerhalb der Listen.
  personenDruck: 'einsatz-personen-druck',
  tiereDruck: 'einsatz-tiere-druck',
  schaedenDruck: 'einsatz-schaeden-druck',
  // Einsatzbericht: ein Schnappschuss über alle Quellen (LFH-726).
  einsatzberichtDruck: 'einsatz-einsatzbericht-druck',
  // Auftragsdruck: ein Auftrag als Schnappschuss, eigener Prefix außerhalb von `auftraege` (LLH-1171).
  auftragDruck: 'einsatz-auftrag-druck',
  // Druckansicht einer Person: Schnappschuss, eigener Prefix außerhalb von `person` (LLH-1120).
  personDruck: 'einsatz-person-druck',
} as const;

export type EinsatzKey = (typeof EINSATZ_KEYS)[keyof typeof EINSATZ_KEYS];

/** Wessen Meldereihe ein Verlauf trägt: Standmeldungen eines Bezirks (Modul Evakuierung) oder
 *  Belegungsmeldungen einer Stelle (Modul Betreuung). */
export type BetreuungVerlaufArt = 'bezirk' | 'stelle';

/**
 * Wire-Event-Name (SSE `type`) → die Query-Key-Prefixe, die das Event invalidiert.
 * NICHT enthalten:
 * - `sofortmeldung`: im Hook, invalidiert die `meldung`-Keys, aber nicht im lagged-Fan-out
 *   (Ton und Toast trägt die Benachrichtigung, design.md D5).
 * - `lagged`: rein abgeleitet (Union aller Keys hier, dedupliziert) → im Hook.
 */
export const EINSATZ_STREAM_EVENTS = {
  // Ablegen und Entfernen einer UHS-Datei verteilen `uhs` (LFH-758). Das Detail trägt die Plätze
  // und ist live, weil der UHS-Laptop den Grundriss offen hält, den die Einsatzleitung ändert
  // (LFH-892).
  uhs: [
    EINSATZ_KEYS.uhs,
    EINSATZ_KEYS.uhsDetail,
    EINSATZ_KEYS.uhsAnhaenge,
    EINSATZ_KEYS.lagemonitor,
  ],
  // Ablegen und Entfernen einer Datei verteilen `schaden`; die Anhangliste der Detailseite hängt
  // deshalb mit daran. Gezielt (Zeile, Anhangliste) ordnet {@link EINSATZ_STREAM_ZIELE} zu.
  schaden: [EINSATZ_KEYS.schaeden, EINSATZ_KEYS.schadenMarker, EINSATZ_KEYS.schadenAnhaenge],
  // Der Status einer Einheit ist aus ihren Fahrzeugen abgeleitet.
  // Ein markierter Fahrzeugstatus schreibt die Zeitachse seiner Einheit (LFH-552).
  fahrzeug: [
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.modulZaehler,
    EINSATZ_KEYS.kraefteZeitachse,
    // Der Zustand jedes Fahrzeugs einer Vorlage im Einsatz (LLH-1049).
    EINSATZ_KEYS.einheitAusVorlage,
    // „Im Einsatz“ der Verbleib-Maske (LLH-1332).
    EINSATZ_KEYS.personenTransportmittel,
  ],
  // Das UHS-Detail trägt das dort verortete Material (LFH-892).
  material: [EINSATZ_KEYS.material, EINSATZ_KEYS.uhsDetail],
  // Ablegen und Entfernen einer Tier-Datei verteilen `tier` (LFH-758).
  tier: [EINSATZ_KEYS.tiere, EINSATZ_KEYS.tierAnhaenge],
  // Der Lagemonitor zeigt die Gefahrenzonen aus seinem Lagebild (LLH-1153).
  lage_zone: [EINSATZ_KEYS.zonen, EINSATZ_KEYS.gefahrengebiete, EINSATZ_KEYS.lagemonitor],
  freies_zeichen: [EINSATZ_KEYS.freieZeichen],
  gefahr: [EINSATZ_KEYS.gefahrenmatrix, EINSATZ_KEYS.gefahrengebiete],
  einheit: [
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.fuehrungskraefte,
    // Mitglieder-Zuordnungen an Einheiten betreffen auch Personal-, Fahrzeug- und Material-Listen.
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.material,
    EINSATZ_KEYS.modulZaehler,
    // Ablösungsschichten tragen den Einheitsnamen per Join, und das Auflösen einer Einheit entfernt
    // ihre Schichten; beides feuert nur `einheit`.
    EINSATZ_KEYS.abloesungen,
    // Handstatus, Nachtrag und Streichung an einer Einheit (LFH-552).
    EINSATZ_KEYS.kraefteZeitachse,
    EINSATZ_KEYS.lagemonitor,
    // „in «2. Zug»“ an den Kräften einer Vorlage (LLH-1049).
    EINSATZ_KEYS.einheitAusVorlage,
    // Die Empfängerliste der Verpflegung ist eine Projektion der Einheiten in
    // `GET …/verpflegung` (LLH-1055 D4); der Server verteilt `einheit` dafür auch an Leser der
    // Verpflegung.
    EINSATZ_KEYS.verpflegung,
  ],
  // Abschnittsname und -liste speisen die Rhythmus-Vorgaben der Ablösung; Bezirke und
  // Betreuungsstellen tragen den Abschnittsnamen per Join. Umbenennen oder Löschen eines
  // Abschnitts feuert nur dieses Ereignis.
  abschnitt: [
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.fuehrungskraefte,
    EINSATZ_KEYS.modulZaehler,
    EINSATZ_KEYS.abloesungen,
    EINSATZ_KEYS.betreuung,
    EINSATZ_KEYS.evakuierung,
    // Abschnittsflächen im Lagebild des Lagemonitors (LLH-1153).
    EINSATZ_KEYS.lagemonitor,
    // Die BR-Liste trägt den Abschnittsnamen per Join (LLH-1095).
    EINSATZ_KEYS.br,
    // Abschnitte als Empfänger und Abschnittsnamen der Einheiten in der Empfängerliste der
    // Verpflegung (LLH-1055 D4).
    EINSATZ_KEYS.verpflegung,
  ],
  // Betroffene Personen (Modul `personen`); `personal` ist ein eigenes Ereignis. Die
  // Betreuungsübersicht trägt „davon namentlich n“ je Stelle, das sich mit jedem Verbleib ändert.
  // Kein zweites Server-Ereignis: `person` erreicht nur Leser mit Personenrecht, und nur die sehen
  // die Zahl.
  // Ablegen und Entfernen einer Datei an einer Person verteilen `person` (LFH-757); die
  // Anhangliste hängt mit daran. Das Detail (`person`) bleibt NICHT live: jeder Abruf schreibt
  // eine Audit-Zeile, die Liste der Anhänge schreibt keine.
  person: [
    EINSATZ_KEYS.personen,
    EINSATZ_KEYS.personenAuswahl,
    EINSATZ_KEYS.modulZaehler,
    EINSATZ_KEYS.betreuung,
    EINSATZ_KEYS.personAnhaenge,
    EINSATZ_KEYS.personenTransportmittel,
  ],
  // Disponiertes Personal (Modul `personal`) — die Zuordnung wirkt zugleich auf
  // Einheiten-/Abschnittsführung und die Führungskräfte-Sicht der Lagekarte.
  personal: [
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.fuehrungskraefte,
    EINSATZ_KEYS.modulZaehler,
    // Statuswechsel, Nachtrag, Streichung und Fan-out an einer Person (LFH-552).
    EINSATZ_KEYS.kraefteZeitachse,
    EINSATZ_KEYS.lagemonitor,
    // Die Stärke einer UHS zählt die Positionen ihrer Kräfte (LFH-1045): eine geänderte Position
    // oder eine entlassene Kraft ändert Liste und Detail der UHS.
    EINSATZ_KEYS.uhs,
    EINSATZ_KEYS.uhsDetail,
    // Der Zustand jeder Person einer Vorlage im Einsatz (LLH-1049).
    EINSATZ_KEYS.einheitAusVorlage,
  ],
  lagebericht: [
    EINSATZ_KEYS.lageberichte,
    EINSATZ_KEYS.lagebericht,
    EINSATZ_KEYS.lageberichtAnlagen,
  ],
  chat: [EINSATZ_KEYS.chatKanaele, EINSATZ_KEYS.chatNachrichten, EINSATZ_KEYS.modulZaehler],
  erinnerung: [EINSATZ_KEYS.erinnerungen, EINSATZ_KEYS.modulZaehler],
  auftrag: [EINSATZ_KEYS.auftraege, EINSATZ_KEYS.modulZaehler],
  // Der Modulzähler zählt die offenen Nachforderungen je Stufe (LLH-1078).
  // Erwartete Kräfte eines Raums lesen Status, Zusage und Verweise (LLH-1387).
  nachforderung: [EINSATZ_KEYS.nachforderungen, EINSATZ_KEYS.brErwartet, EINSATZ_KEYS.modulZaehler],
  meldung: [EINSATZ_KEYS.meldungen, EINSATZ_KEYS.lagemeldungen, EINSATZ_KEYS.modulZaehler],
  // Liste + Detail + Verlauf (Prefix-Match: ['einsatz-br-detail', einsatzId] trifft alle brIds).
  bereitstellungsraum: [
    EINSATZ_KEYS.br,
    EINSATZ_KEYS.brDetail,
    EINSATZ_KEYS.brVerlauf,
    EINSATZ_KEYS.brErwartet,
    EINSATZ_KEYS.brStammTreffer,
  ],
  karte_bild: [EINSATZ_KEYS.kartenbilder],
  // Prefix-Match deckt ['etb', einsatzId, filter] mit ab.
  etb: [EINSATZ_KEYS.etb, EINSATZ_KEYS.modulZaehler],
  // Invalidiert Befehls-Liste UND -Detail (Prefix-Match trifft alle befehlIds).
  befehl: [EINSATZ_KEYS.befehle, EINSATZ_KEYS.befehl, EINSATZ_KEYS.befehlAnlagen],
  // „Für den Einsatz speichern“ aktualisiert den Ansichts-Switcher aller Betrachter.
  karten_ansicht: [EINSATZ_KEYS.kartenAnsicht],
  lage_snapshot: [EINSATZ_KEYS.lageSnapshot],
  // Führungsorganisation (Besetzung S1–S6 und Checkliste unter EINEM Prefix). Die Lagebesprechung
  // (LLH-1111) und das Fernmeldewesen (LLH-1180) haben ihr eigenes Ereignis.
  // Aufträge und Erinnerungen an ein Sachgebiet lösen zur Lesezeit auf die Besetzung auf
  // (LFH-549): ein Besetzungswechsel ändert ihre Anzeige. Beide sind gezählte Listen, deshalb geht
  // der Modulzähler mit (Regel aus `queryKeys.test.ts`), auch wenn sich die Zahl hier nicht ändert.
  stab: [
    EINSATZ_KEYS.stab,
    EINSATZ_KEYS.auftraege,
    EINSATZ_KEYS.erinnerungen,
    EINSATZ_KEYS.modulZaehler,
  ],
  // Lagebesprechung (LLH-1111): Stand und Verlauf unter EINEM Prefix. Kein Modulzähler (das Modul
  // zählt nichts); der ETB-Nachweis des Abschlusses kommt über das eigene `etb`-Ereignis.
  lagebesprechung: [EINSATZ_KEYS.lagebesprechung],
  // Fernmeldewesen (LLH-1180): Kommunikationsplan und Skizze. Kein Modulzähler (das Modul zählt
  // nichts); die Besetzung im Nebentext kommt über `stab`.
  fernmeldewesen: [EINSATZ_KEYS.fernmeldewesen],
  // Der ETB-Nachweis kommt über das eigene `etb`-Ereignis.
  dokument: [EINSATZ_KEYS.dokumente, EINSATZ_KEYS.modulZaehler],
  // Schichten und Rhythmus-Vorgaben hängen unter EINEM Prefix (Sub-Keys 'liste'/'vorgaben'). Trägt
  // das Ereignis `art`, stammt es vom Scheduler; alarmiert wird über die Benachrichtigung.
  // Der Vollzug beendet die Einsatzperiode der abgelösten Einheit (LFH-552).
  abloesung: [EINSATZ_KEYS.abloesungen, EINSATZ_KEYS.kraefteZeitachse],
  // Stellen und ihre Meldereihen unter EINEM Prefix, damit ein Ereignis Übersicht und Kopfzahl
  // trifft. Nutzlast nur Kennungen. Den Modulzähler rechnet der Client aus der Übersicht
  // (`ClientZaehlerQuelle`), er hängt am selben Prefix.
  betreuung: [EINSATZ_KEYS.betreuung],
  // Bezirke und ihre Standreihen (LLH-1034), wie `betreuung`. Die Kennzahl „Evakuiert“ und der
  // Modulzähler lesen dieselbe Übersicht.
  evakuierung: [EINSATZ_KEYS.evakuierung],
  // Zeitfenster samt Deckung und Ausgaben unter EINEM Prefix. Kein Fan-out von `nachforderung`:
  // das DTO trägt nur die Kennung.
  verpflegung: [EINSATZ_KEYS.verpflegung],
  // Einsatzkopf (LFH-555). Der Stand der Lagebesprechung liefert den Termin der nächsten
  // Lagebesprechung aus derselben Spalte mit (LFH-46, Entscheidung 11; LLH-1111), deshalb hängt er
  // hier mit dran: eine Terminwahrheit, zwei Caches. `lagekennzahlen` lösen es aus, aber nur beim Umschalten einer
  // Kennzahl, nicht bei jeder Pegel- oder Bezirksänderung (LFH-855). Die Stab-Besetzung
  // (`meine_sachgebiete`) löst es nicht aus; sie wird beim nächsten Abruf frisch. Die eigene
  // Führungsstelle (LFH-849) meldet ihre Änderung über dasselbe Ereignis.
  // Die Vorgabe je Funktion (LLH-1421, design.md D4) meldet ihr Setzen über dasselbe Ereignis.
  einsatz: [
    EINSATZ_KEYS.einsatz,
    EINSATZ_KEYS.lagebesprechung,
    EINSATZ_KEYS.fuehrungsstelle,
    EINSATZ_KEYS.benachrichtigungVorgaben,
  ],
  // Medienkontakte, Pressemitteilungen und ihre Details unter EINEM Prefix. Die Freigabe schreibt
  // den ETB-Snapshot; der kommt über das eigene `etb`-Ereignis.
  presse: [EINSATZ_KEYS.presse],
  infotelefon: [EINSATZ_KEYS.infotelefon],
} as const satisfies Record<string, readonly EinsatzKey[]>;

export type EinsatzStreamEvent = keyof typeof EINSATZ_STREAM_EVENTS;

/** Listen, die ein Live-Ereignis zeilenweise abgleicht (`live/zeilenAbgleich.ts`, LFH-931). */
export type ZeilenZiel = 'medienkontakte' | 'schaeden';

/** Ein gezielter Abgleich: einen Key (samt Prefix-Match) oder eine Zeile einer Liste. */
export type LiveAbgleich =
  | { readonly art: 'key'; readonly key: readonly unknown[] }
  | { readonly art: 'zeile'; readonly ziel: ZeilenZiel; readonly id: number };

type LivePayload = Readonly<Record<string, unknown>>;

const kennung = (p: LivePayload, feld: string): number | null =>
  typeof p[feld] === 'number' ? p[feld] : null;

const key = (k: readonly unknown[]): LiveAbgleich => ({ art: 'key', key: k });

/** Dokument mit Kopfliste (LFH-931, design.md D2): `nur_inhalt` heißt, der PATCH hat nur
 *  Abschnitte geändert; dann bleibt die Kopfliste, und nur das Detail dieser Kennung gleicht ab. */
const dokument =
  (
    feld: string,
    liste: readonly unknown[],
    detail: (id: number) => readonly unknown[],
    anlagen?: (id: number) => readonly unknown[],
  ) =>
  (p: LivePayload): readonly LiveAbgleich[] | null => {
    const id = kennung(p, feld);
    if (id === null) return null;
    // `anlagen` (LFH-1028): nur die Anlagen dieses Dokuments; Kopf und Text bleiben.
    if (p.anlagen === true && anlagen) return [key(anlagen(id))];
    return p.nur_inhalt === true ? [key(detail(id))] : [key(liste), key(detail(id))];
  };

/**
 * Gezielte Zuordnung nach Payload (LFH-931, Spec `live-abgleich`, design.md D4): Wire-Event →
 * Funktion von Payload und Einsatz auf die Abgleiche, die dieses Objekt betrifft. `null` (Kennung
 * fehlt, etwa beim Purge) fällt auf die Prefixe aus {@link EINSATZ_STREAM_EVENTS} zurück, die
 * auch `lagged` und jeder Wiederaufbau ohne Nachlieferung abgleichen.
 */
export const EINSATZ_STREAM_ZIELE: Partial<
  Record<EinsatzStreamEvent, (p: LivePayload, einsatzId: number) => readonly LiveAbgleich[] | null>
> = {
  lagebericht: (p, e) =>
    dokument(
      'lagebericht_id',
      einsatzKeys.lageberichte(e),
      (id) => einsatzKeys.lagebericht(e, id),
      (id) => einsatzKeys.lageberichtAnlagen(e, id),
    )(p),
  befehl: (p, e) =>
    dokument(
      'befehl_id',
      einsatzKeys.befehle(e),
      (id) => einsatzKeys.befehl(e, id),
      (id) => einsatzKeys.befehlAnlagen(e, id),
    )(p),
  // Ein Ereignis teilt sich der Name mit den Pressemitteilungen: Medienkontakte gleichen
  // zeilenweise ab, Mitteilungen wie ein Dokument. Keines von beiden trifft das andere.
  presse: (p, e) => {
    const kid = kennung(p, 'medienkontakt_id');
    // Die Kennzahlen zählen den ganzen Bestand; sie gleichen bei jeder Änderung ab (LFH-1075).
    if (kid !== null)
      return [
        { art: 'zeile', ziel: 'medienkontakte', id: kid },
        key(einsatzKeys.medienkontaktKennzahlen(e)),
      ];
    return dokument('pressemitteilung_id', einsatzKeys.pressemitteilungen(e), (id) =>
      einsatzKeys.pressemitteilung(e, id),
    )(p);
  },
  // `anhang`: eine Datei am Schaden; Liste und Marker tragen davon nichts.
  schaden: (p, e) => {
    const sid = kennung(p, 'schaden_id');
    if (sid === null) return null;
    if (p.anhang === true) return [key(einsatzKeys.schadenAnhaenge(e, sid))];
    return [
      { art: 'zeile', ziel: 'schaeden', id: sid },
      key(einsatzKeys.schaedenGeschaedigtAlle(e)),
      key(einsatzKeys.schaedenKennzahlenAlle(e)),
    ];
  },
};

/**
 * Managed einsatz-scoped Keys, die BEWUSST nicht über den SSE-Live-Feed invalidiert werden.
 * `queryKeys.guard.test.ts` verlangt, dass jeder Key aus {@link EINSATZ_KEYS} entweder in
 * {@link EINSATZ_STREAM_EVENTS} auftaucht ODER hier steht.
 *
 * - `einstellungen`/`mitglieder`/`sprechgruppen`: selten geändert, kein Live-Event. Der
 *   Einsatzkopf `einsatz` ist seit LFH-555 live.
 * - `mitgliedAuswahl` (LFH-1141): wie `mitglieder`; die eigene Aufnahme oder Entfernung
 *   invalidiert sie, eine neu angelegte Person erscheint beim nächsten Abruf.
 * - `person`/`personAudit`/`tier`/`schaden`: Singular-Detail-Keys, die der
 *   Listen-Prefix-Match nicht erreicht.
 * - `modulOverrides`: das Backend kennt kein LiveEvent dafür (`LiveEvent::ALLE`); ein Override
 *   eines anderen Nutzers propagiert nicht live.
 * - `modulVorgaben` (LLH-1183): Org-Vorgaben ohne LiveEvent wie `orgModulEinstellungen`; die
 *   eigene Änderung in der Verwaltung invalidiert sie für alle Einsätze.
 * - `geraete` (LFH-892): Kopplungen sieht nur die Einsatzleitung auf ihrer Einstellungsseite; die
 *   eigene Änderung setzt die Antwort, der letzte Zugriff eines Geräts ist kein Ereignis.
 * - `modulFreigaben`: abgeleitet aus Overrides und Org-Vorgaben, beide ohne LiveEvent (LFH-669).
 *   Die eigene Änderung invalidiert die Mutation; die eines anderen wirkt beim nächsten Abruf,
 *   das 403 der Server-Gates bleibt das Netz.
 * - `ortVorschau`: abgeleiteter Geo-Lookup mit Debounce + Client-Cache; live zu invalidieren
 *   wäre schädlich (Nominatim-ToS).
 * - `ortSuche`, `einsatzortSuche`: Adresssuche auf Enter (LFH-638, LFH-1175), aus demselben
 *   Grund nie live; bewusst auch
 *   nicht im Lagebild offline (der Suchtext kann eine Personenadresse sein).
 * - `pegel`: kein Live-Ereignis; die Abfrage fragt alle 5 min nach (`PEGEL_ABRUF_MS`), die
 *   Mutationen setzen die Antwort per `setQueryData`.
 * - `wetter`: externe Quelle (Bright Sky), 5-min-Nachfrage.
 * - `etbDruck`: ein Druckbeleg ist ein Schnappschuss; ein neuer Eintrag darf ihn nicht still
 *   ergänzen („Neu laden“ ist eine ausdrückliche Handlung). Deshalb der eigene Prefix: unter
 *   `etb` zöge ihn das `etb`-Ereignis per Präfix mit.
 * - `personenDruck`/`tiereDruck`/`schaedenDruck` (LFH-727): dieselbe Begründung wie `etbDruck`
 *   für die Druckansichten der Modul-Listen. Beim Personendruck kommt hinzu: jeder Abruf ist ein
 *   Eintrag im Zugriffsprotokoll, ein Live-Refetch schriebe also Protokollzeilen ohne Handlung.
 * - `uhsAnhangZugriffe` (LFH-758): das Zugriffsprotokoll der UHS-Dateien lädt erst beim
 *   Aufklappen, wie `personAudit`; ein Live-Refetch zeigte Abrufe anderer ohne Handlung der
 *   Einsatzleitung und liefe bei jedem `uhs`-Ereignis mit.
 * - `personenListenzugriffe` (LFH-916): Export und Druck der Personenliste lädt erst mit der
 *   geöffneten Ansicht, aus demselben Grund wie `uhsAnhangZugriffe`.
 * - `personenBestaetiger` (LFH-1046): das Gerät erhält keine Personal-Ereignisse (Ansicht); die
 *   Auswahl lädt mit dem Dialog neu.
 * - `einsatzberichtDruck`: derselbe Schnappschuss-Grundsatz für den Einsatzbericht (LFH-726): EIN
 *   Stand über alle Quellen; ein Modul-Ereignis darf den geöffneten Bericht nicht still ändern.
 * - `auftragDruck` (LLH-1171): derselbe Schnappschuss-Grundsatz für das Blatt eines Auftrags; eine
 *   Quittung an einem anderen Gerät darf es nicht still ändern. Unter `auftraege` zöge ihn das
 *   Ereignis `auftrag` per Präfix mit.
 * - `personDruck` (LLH-1120): derselbe Schnappschuss-Grundsatz für das Blatt einer Person; jeder
 *   Abruf schreibt einen `druck`-Eintrag ins Zugriffsprotokoll, ein Live-Refetch schriebe weitere.
 * - `anhangHeicVorschau` (LFH-759): ein Anhang ändert sich nie, die Schwärzung löscht ihn nur;
 *   ein Live-Refetch dekodierte dasselbe HEIC noch einmal.
 * - `uhsPlanBild` (LFH-999): der Key trägt den sha256 aus dem live geführten Detail; ein neuer
 *   Plan ist ein neuer Key, ein Live-Refetch lüde dieselben Bytes noch einmal.
 * - `benachrichtigungVerlauf` (LLH-1143): das Ereignis `benachrichtigung` ist empfängergebunden
 *   und steht deshalb nicht in `EINSATZ_STREAM_EVENTS` (`live/benachrichtigungListener.ts`); die
 *   Zentrale gleicht den Verlauf bei jedem ihrer Ereignisse über den Sammler ab
 *   (`alarm/useBenachrichtigungVerlauf.ts`).
 */
export const NICHT_LIVE_KEYS = [
  EINSATZ_KEYS.einstellungen,
  EINSATZ_KEYS.mitglieder,
  EINSATZ_KEYS.mitgliedAuswahl,
  EINSATZ_KEYS.sprechgruppen,
  EINSATZ_KEYS.modulOverrides,
  EINSATZ_KEYS.modulVorgaben,
  EINSATZ_KEYS.geraete,
  EINSATZ_KEYS.modulFreigaben,
  EINSATZ_KEYS.benachrichtigungVerlauf,
  EINSATZ_KEYS.ortVorschau,
  EINSATZ_KEYS.ortSuche,
  EINSATZ_KEYS.einsatzortSuche,
  EINSATZ_KEYS.anhangHeicVorschau,
  EINSATZ_KEYS.person,
  EINSATZ_KEYS.personAudit,
  EINSATZ_KEYS.tier,
  EINSATZ_KEYS.schaden,
  EINSATZ_KEYS.lageSnapshotDokument,
  EINSATZ_KEYS.pegel,
  EINSATZ_KEYS.wetter,
  EINSATZ_KEYS.etbDruck,
  EINSATZ_KEYS.personenDruck,
  EINSATZ_KEYS.tiereDruck,
  EINSATZ_KEYS.schaedenDruck,
  EINSATZ_KEYS.einsatzberichtDruck,
  EINSATZ_KEYS.auftragDruck,
  EINSATZ_KEYS.personDruck,
  EINSATZ_KEYS.uhsAnhangZugriffe,
  EINSATZ_KEYS.uhsPlanBild,
  EINSATZ_KEYS.personenListenzugriffe,
  EINSATZ_KEYS.personenBestaetiger,
  EINSATZ_KEYS.nachforderungArten,
] as const satisfies readonly EinsatzKey[];

/**
 * Typisierte Key-Factory für alle einsatz-scoped Queries. Konvention: 2-elementige Funktionen
 * `[prefix, einsatzId]` sind zugleich der Invalidierungs-Prefix (TanStack matcht per Prefix);
 * Detail-/Filter-Varianten hängen weitere Elemente an.
 */
/** Phase einer geteilten Liste (Meldungen, Erinnerungen; LFH-940). */
export type ListenPhase = 'offen' | 'abgeschlossen';

/** Sub-Key der Rückmeldungen unter dem `meldungen`-Prefix. */
const RUECKMELDUNGEN_SUBKEY = 'rueckmeldungen';

/**
 * Trifft die Rückmeldungen ALLER Einsätze. Die Fälligkeit rechnet der Server aus der
 * Rückmeldefrist; ändert eine Org-Vorgabe sie, meldet das kein Live-Ereignis.
 */
export function istRueckmeldungenKey(key: readonly unknown[]): boolean {
  return key[0] === EINSATZ_KEYS.meldungen && key[2] === RUECKMELDUNGEN_SUBKEY;
}

/** Alle einsatz-scoped Prefixe als Menge — Grundlage von {@link istKeyDesEinsatzes}. */
const EINSATZ_PREFIXE: ReadonlySet<unknown> = new Set<unknown>(Object.values(EINSATZ_KEYS));

/**
 * Trifft JEDEN einsatz-scoped Key eines Einsatzes, Listen wie Detail- und Sub-Keys (nach Import
 * oder Entfernen der Demo-Daten). Ein Prefix-Match reicht nicht, die Einsatz-ID steht an Stelle
 * 1 hinter vielen verschiedenen Prefixen; alle Accessoren von {@link einsatzKeys} tragen sie
 * dort.
 *
 * Seit LFH-723 auch für `removeQueries`: der Rechteentzug räumt damit alle Keys eines
 * Einsatzes (`api/queryClient.ts`). Die XOR-Auflage aus dem Kopf von {@link GLOBAL_KEYS}
 * löst das NICHT aus — die Räumung wählt nur einsatzbezogene Keys, deren Partition
 * live/nicht-live ohnehin maschinell erzwungen ist; eine Menge „alle Org-Keys" braucht sie
 * nicht.
 */
export function istKeyDesEinsatzes(key: readonly unknown[], einsatzId: number): boolean {
  return EINSATZ_PREFIXE.has(key[0]) && key[1] === einsatzId;
}

export const einsatzKeys = {
  // Einsatz-Stammdaten. einsatzId nullbar: die Kommandopalette lädt den Einsatz nur im
  // Einsatzkontext (enabled-Guard).
  einsatz: (einsatzId: number | null) => [EINSATZ_KEYS.einsatz, einsatzId] as const,
  /** Eigene Führungsstelle (LFH-849), live über `einsatz`. */
  fuehrungsstelle: (einsatzId: number) => [EINSATZ_KEYS.fuehrungsstelle, einsatzId] as const,
  einstellungen: (einsatzId: number) => [EINSATZ_KEYS.einstellungen, einsatzId] as const,
  /** Aufbewahrung je Datenkategorie (LFH-749) — Unter-Key der Einstellungen: dieselbe Seite,
   *  dieselbe Invalidierung, kein Live-Ereignis, kein Personenbezug. */
  aufbewahrungKategorien: (einsatzId: number) =>
    [EINSATZ_KEYS.einstellungen, einsatzId, 'aufbewahrung-kategorien'] as const,
  mitglieder: (einsatzId: number) => [EINSATZ_KEYS.mitglieder, einsatzId] as const,
  /** Aufnehmbare Personen der Einsatz-Org (LFH-1141), nur für die Einsatzleitung, nicht live. */
  mitgliedAuswahl: (einsatzId: number) => [EINSATZ_KEYS.mitgliedAuswahl, einsatzId] as const,
  sprechgruppen: (einsatzId: number) => [EINSATZ_KEYS.sprechgruppen, einsatzId] as const,
  // einsatzId nullbar aus demselben Grund wie bei `einsatz`.
  modulOverrides: (einsatzId: number | null) => [EINSATZ_KEYS.modulOverrides, einsatzId] as const,
  /** Modul-Vorgaben der Einsatz-Org (LLH-1183), nicht live. */
  modulVorgaben: (einsatzId: number) => [EINSATZ_KEYS.modulVorgaben, einsatzId] as const,
  // Invalidierungs-Prefix über ALLE Einsätze: eine Org-Vorgabe gilt für jeden Einsatz der Org.
  modulVorgabenAlle: () => [EINSATZ_KEYS.modulVorgaben] as const,
  /** Kopplungen und Modulsperren je Ansicht (LFH-892), nicht live. */
  geraete: (einsatzId: number) => [EINSATZ_KEYS.geraete, einsatzId] as const,
  // einsatzId nullbar aus demselben Grund wie bei `einsatz`.
  modulFreigaben: (einsatzId: number | null) => [EINSATZ_KEYS.modulFreigaben, einsatzId] as const,
  // Invalidierungs-Prefix über ALLE Einsätze: eine Org-Vorgabe wirkt auf jeden Einsatz der Org.
  modulFreigabenAlle: () => [EINSATZ_KEYS.modulFreigaben] as const,
  benachrichtigungVerlauf: (einsatzId: number) =>
    [EINSATZ_KEYS.benachrichtigungVerlauf, einsatzId] as const,
  /** Vorgabe je Funktion am Einsatz (LLH-1421), Sektion „Benachrichtigungen“. */
  benachrichtigungVorgaben: (einsatzId: number) =>
    [EINSATZ_KEYS.benachrichtigungVorgaben, einsatzId] as const,

  // Personen / Personal
  personen: (einsatzId: number) => [EINSATZ_KEYS.personen, einsatzId] as const,
  /** Betroffene einer Betreuungsstelle (LLH-1044, Serverfilter); unter `personen`, damit das
   *  `person`-Ereignis und jede Personen-Mutation sie mit auffrischen. */
  personenDerStelle: (einsatzId: number, stelleId: number) =>
    [EINSATZ_KEYS.personen, einsatzId, 'stelle', stelleId] as const,
  personenAuswahl: (einsatzId: number) => [EINSATZ_KEYS.personenAuswahl, einsatzId] as const,
  // personId nullbar: der Person-Detail-Drawer rendert ohne Auswahl (enabled-Guard).
  person: (einsatzId: number, personId: number | null) =>
    [EINSATZ_KEYS.person, einsatzId, personId] as const,
  personAudit: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.personAudit, einsatzId, personId] as const,
  personenListenzugriffe: (einsatzId: number) =>
    [EINSATZ_KEYS.personenListenzugriffe, einsatzId] as const,
  personenBestaetiger: (einsatzId: number) =>
    [EINSATZ_KEYS.personenBestaetiger, einsatzId] as const,
  personenTransportmittel: (einsatzId: number) =>
    [EINSATZ_KEYS.personenTransportmittel, einsatzId] as const,
  personAnhaenge: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.personAnhaenge, einsatzId, personId] as const,
  personal: (einsatzId: number) => [EINSATZ_KEYS.personal, einsatzId] as const,
  /** Einsatzkräfte ohne UHS (LFH-1045), Auswahl beim Zuordnen; unter `personal`, weil jede
   *  Zuordnung `personal` verteilt. */
  personalOhneUhs: (einsatzId: number) => [EINSATZ_KEYS.personal, einsatzId, 'ohne-uhs'] as const,
  /** Entlassene Kräfte (LLH-1079, Block „Entlassen“); unter `personal`, weil Entlassen und
   *  erneutes Disponieren `personal` verteilen. */
  personalEntlassene: (einsatzId: number) =>
    [EINSATZ_KEYS.personal, einsatzId, 'entlassene'] as const,
  fuehrungskraefte: (einsatzId: number) => [EINSATZ_KEYS.fuehrungskraefte, einsatzId] as const,

  // Struktur
  einheiten: (einsatzId: number) => [EINSATZ_KEYS.einheiten, einsatzId] as const,
  /** Aufgelöste Einheiten (LLH-1079); unter `einheiten`, weil das Auflösen `einheit` verteilt. */
  einheitenAufgeloeste: (einsatzId: number) =>
    [EINSATZ_KEYS.einheiten, einsatzId, 'aufgeloeste'] as const,
  /** Vorschau einer Einheiten-Vorlage im Einsatz (LLH-1049): Baum und Zustand jeder Kraft. */
  einheitAusVorlage: (einsatzId: number, vorlageId: number) =>
    [EINSATZ_KEYS.einheitAusVorlage, einsatzId, vorlageId] as const,
  abschnitte: (einsatzId: number) => [EINSATZ_KEYS.abschnitte, einsatzId] as const,
  fahrzeuge: (einsatzId: number) => [EINSATZ_KEYS.fahrzeuge, einsatzId] as const,
  /** Entlassene Fahrzeuge (LLH-1079 Teil II): unter dem Präfix der Liste, gleiche Invalidierung. */
  fahrzeugeEntlassene: (einsatzId: number) =>
    [EINSATZ_KEYS.fahrzeuge, einsatzId, 'entlassene'] as const,
  material: (einsatzId: number) => [EINSATZ_KEYS.material, einsatzId] as const,
  /** Aus dem Einsatz genommenes Material (LLH-1079 Teil II): unter dem Präfix der Liste. */
  materialEntlassene: (einsatzId: number) =>
    [EINSATZ_KEYS.material, einsatzId, 'entlassene'] as const,

  // UHS
  uhs: (einsatzId: number) => [EINSATZ_KEYS.uhs, einsatzId] as const,
  uhsDetail: (einsatzId: number, uhsId: number) =>
    [EINSATZ_KEYS.uhsDetail, einsatzId, uhsId] as const,
  uhsAnhaenge: (einsatzId: number, uhsId: number) =>
    [EINSATZ_KEYS.uhsAnhaenge, einsatzId, uhsId] as const,
  uhsAnhangZugriffe: (einsatzId: number, uhsId: number) =>
    [EINSATZ_KEYS.uhsAnhangZugriffe, einsatzId, uhsId] as const,
  uhsPlanBild: (einsatzId: number, uhsId: number, sha256: string) =>
    [EINSATZ_KEYS.uhsPlanBild, einsatzId, uhsId, sha256] as const,

  // Schäden / Tiere (inkl. personenbezogener Kontext-Filter)
  schaeden: (einsatzId: number) => [EINSATZ_KEYS.schaeden, einsatzId] as const,
  schaedenGeschaedigt: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'geschaedigt', personId] as const,
  /** Prefix aller {@link einsatzKeys.schaedenGeschaedigt}-Listen eines Einsatzes. */
  schaedenGeschaedigtAlle: (einsatzId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'geschaedigt'] as const,
  /** Modulseite (LFH-1075): eine Seitenkette je Sicht und Sortierung. */
  schaedenSeiten: (einsatzId: number, sicht: SchaedenFilter, sortierung: SchadenSortierung) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'seiten', { sicht, sortierung }] as const,
  /** Prefix aller {@link einsatzKeys.schaedenSeiten} eines Einsatzes (Zeilenabgleich). */
  schaedenSeitenAlle: (einsatzId: number) => [EINSATZ_KEYS.schaeden, einsatzId, 'seiten'] as const,
  /** Zahlen der Modulseite zu einer Sicht ohne Status (LFH-1075). */
  schaedenKennzahlen: (einsatzId: number, sicht: Omit<SchaedenFilter, 'status'>) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'kennzahlen', sicht] as const,
  schaedenKennzahlenAlle: (einsatzId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'kennzahlen'] as const,
  /** Auswahl ohne Freitext: Chat-Bezug, Zuweisung, Sprungpalette (LFH-1075). */
  schaedenAuswahl: (einsatzId: number) => [EINSATZ_KEYS.schaeden, einsatzId, 'auswahl'] as const,
  /** Ein Schaden unter dem Listen-Prefix, live (Palettenvorschau, LFH-1075); anders als das
   *  Detailfach {@link einsatzKeys.schaden} der Detailseite. */
  schaedenEinzeln: (einsatzId: number, schadenId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'einzeln', schadenId] as const,
  schaedenEinzelnAlle: (einsatzId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'einzeln'] as const,
  schadenMarker: (einsatzId: number) => [EINSATZ_KEYS.schadenMarker, einsatzId] as const,
  schaden: (einsatzId: number, schadenId: number) =>
    [EINSATZ_KEYS.schaden, einsatzId, schadenId] as const,
  schadenAnhaenge: (einsatzId: number, schadenId: number) =>
    [EINSATZ_KEYS.schadenAnhaenge, einsatzId, schadenId] as const,
  tiere: (einsatzId: number) => [EINSATZ_KEYS.tiere, einsatzId] as const,
  tiereHalter: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.tiere, einsatzId, 'halter', personId] as const,
  tier: (einsatzId: number, tierId: number) => [EINSATZ_KEYS.tier, einsatzId, tierId] as const,
  tierAnhaenge: (einsatzId: number, tierId: number) =>
    [EINSATZ_KEYS.tierAnhaenge, einsatzId, tierId] as const,

  // Lage
  zonen: (einsatzId: number) => [EINSATZ_KEYS.zonen, einsatzId] as const,
  freieZeichen: (einsatzId: number) => [EINSATZ_KEYS.freieZeichen, einsatzId] as const,
  kartenAnsicht: (einsatzId: number) => [EINSATZ_KEYS.kartenAnsicht, einsatzId] as const,
  lageSnapshot: (einsatzId: number) => [EINSATZ_KEYS.lageSnapshot, einsatzId] as const,
  lageSnapshotDokument: (einsatzId: number, snapshotId: number) =>
    [EINSATZ_KEYS.lageSnapshotDokument, einsatzId, snapshotId] as const,
  gefahrengebiete: (einsatzId: number) => [EINSATZ_KEYS.gefahrengebiete, einsatzId] as const,
  gefahrenmatrix: (einsatzId: number, gewaehlt: number | null) =>
    [EINSATZ_KEYS.gefahrenmatrix, einsatzId, gewaehlt] as const,
  lageberichte: (einsatzId: number) => [EINSATZ_KEYS.lageberichte, einsatzId] as const,
  lagebericht: (einsatzId: number, berichtId: number) =>
    [EINSATZ_KEYS.lagebericht, einsatzId, berichtId] as const,
  lageberichtAnlagen: (einsatzId: number, berichtId: number) =>
    [EINSATZ_KEYS.lageberichtAnlagen, einsatzId, berichtId] as const,
  kartenbilder: (einsatzId: number) => [EINSATZ_KEYS.kartenbilder, einsatzId] as const,
  // Maßgebliche Pegel, NICHT live (siehe NICHT_LIVE_KEYS).
  pegel: (einsatzId: number) => [EINSATZ_KEYS.pegel, einsatzId] as const,
  /** Vorschlag aus der Vorhersage-Reihe `WV` je Pegel, Sub-Key unter demselben Prefix. */
  pegelVorhersage: (einsatzId: number, pegelId: number) =>
    [EINSATZ_KEYS.pegel, einsatzId, 'vorhersage', pegelId] as const,
  /** 24-h-Verlauf aller Pegel, Sub-Key unter demselben, nicht-live Prefix. */
  pegelVerlauf: (einsatzId: number) => [EINSATZ_KEYS.pegel, einsatzId, 'verlauf'] as const,
  /** Wetter am Einsatzort, NICHT live (siehe NICHT_LIVE_KEYS). */
  wetter: (einsatzId: number) => [EINSATZ_KEYS.wetter, einsatzId] as const,
  // ETB-Druckansicht: Vollabruf einer Auswahl, nicht live (siehe NICHT_LIVE_KEYS).
  etbDruck: <F>(einsatzId: number, filter: F) =>
    [EINSATZ_KEYS.etbDruck, einsatzId, filter] as const,
  // Druck der Modul-Listen (LFH-727): Vollabruf ohne Filter im Key, nicht live (siehe
  // NICHT_LIVE_KEYS). Der Filter wählt im Client aus der geladenen Menge.
  personenDruck: (einsatzId: number) => [EINSATZ_KEYS.personenDruck, einsatzId] as const,
  tiereDruck: (einsatzId: number) => [EINSATZ_KEYS.tiereDruck, einsatzId] as const,
  schaedenDruck: (einsatzId: number) => [EINSATZ_KEYS.schaedenDruck, einsatzId] as const,
  // Einsatzbericht: alle Quellen der gewählten Blöcke in einem Abruf, nicht live (siehe
  // NICHT_LIVE_KEYS). `auswahl` ist `auswahlSchluessel` (LFH-902): eine andere Auswahl lädt andere
  // Quellen und bekommt ihren eigenen Stand.
  einsatzberichtDruck: (einsatzId: number, auswahl: string) =>
    [EINSATZ_KEYS.einsatzberichtDruck, einsatzId, auswahl] as const,
  // Auftragsdruck (LLH-1171): ein Auftrag einzeln, nicht live (siehe NICHT_LIVE_KEYS).
  auftragDruck: (einsatzId: number, auftragId: number) =>
    [EINSATZ_KEYS.auftragDruck, einsatzId, auftragId] as const,
  personDruck: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.personDruck, einsatzId, personId] as const,

  // Stab: Führungsorganisation S1–S6.
  stab: (einsatzId: number) => [EINSATZ_KEYS.stab, einsatzId] as const,
  // Lagebesprechung (LLH-1111): Stand; der Verlauf hängt als Sub-Key unter DEMSELBEN Prefix.
  lagebesprechung: (einsatzId: number) => [EINSATZ_KEYS.lagebesprechung, einsatzId] as const,
  lagebesprechungen: (einsatzId: number) =>
    [EINSATZ_KEYS.lagebesprechung, einsatzId, 'verlauf'] as const,
  // Ablösung: argumentlos = Invalidierungs-Prefix; Liste je Statusfilter und Rhythmus-Vorgaben
  // hängen als Sub-Keys darunter.
  abloesungen: (einsatzId: number) => [EINSATZ_KEYS.abloesungen, einsatzId] as const,
  abloesungListe: (einsatzId: number, status: AbloesungStatus) =>
    [EINSATZ_KEYS.abloesungen, einsatzId, 'liste', status] as const,
  abloesungVorgaben: (einsatzId: number) =>
    [EINSATZ_KEYS.abloesungen, einsatzId, 'vorgaben'] as const,
  /** Vorgabe des Einsatzes (LLH-1122); live über `abloesung` wie die Abschnittsvorgaben. */
  abloesungEinsatzVorgabe: (einsatzId: number) =>
    [EINSATZ_KEYS.abloesungen, einsatzId, 'schichtmodell'] as const,
  // Kräfte-Zeitachse (LFH-552): argumentlos = Invalidierungs-Prefix; Perioden-Listen je Kraftart
  // und die Zeitachse einer Kraft hängen als Sub-Keys darunter.
  kraefteZeitachse: (einsatzId: number) => [EINSATZ_KEYS.kraefteZeitachse, einsatzId] as const,
  kraefteZeitachseEinheiten: (einsatzId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'einheiten'] as const,
  kraefteZeitachsePersonal: (einsatzId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'personal'] as const,
  kraefteZeitachseEinheit: (einsatzId: number, einheitId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'einheit', einheitId] as const,
  kraefteZeitachsePerson: (einsatzId: number, epId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'person', epId] as const,
  // Betreuung: argumentlos = Invalidierungs-Prefix (Übersicht und Modulzähler teilen ihn). Die Kopfzahl hängt als Sub-Key darunter, der Stichtag als Wire-String (UTC ohne
  // Zonenkennung), ohne Stichtag der feste Platzhalter 'jetzt'. Nie „jetzt“ als Zeitstempel: der
  // wäre bei jedem Rendern ein neues Cache-Fach samt Abruf.
  betreuung: (einsatzId: number) => [EINSATZ_KEYS.betreuung, einsatzId] as const,
  betreuungKopfzahl: (einsatzId: number, zeitpunkt?: string) =>
    [EINSATZ_KEYS.betreuung, einsatzId, 'kopfzahl', zeitpunkt ?? 'jetzt'] as const,
  /** Belegungsreihe einer Stelle, Sub-Key unter dem Betreuungs-Prefix: das `betreuung`-Ereignis
   *  und jede eigene Mutation treffen den offenen Verlauf mit. */
  betreuungVerlauf: (einsatzId: number, stelleId: number) =>
    [EINSATZ_KEYS.betreuung, einsatzId, 'verlauf', stelleId] as const,
  // Evakuierung (LLH-1034): argumentlos = Invalidierungs-Prefix (Übersicht, Modulzähler und
  // Kennzahl „Evakuiert“ teilen ihn).
  evakuierung: (einsatzId: number) => [EINSATZ_KEYS.evakuierung, einsatzId] as const,
  /** Standreihe eines Bezirks unter dem Evakuierungs-Prefix, wie {@link betreuungVerlauf}. */
  evakuierungVerlauf: (einsatzId: number, bezirkId: number) =>
    [EINSATZ_KEYS.evakuierung, einsatzId, 'verlauf', bezirkId] as const,
  // Verpflegung: ein Abruf trägt alle Zeitfenster samt Deckung und Ausgaben.
  verpflegung: (einsatzId: number) => [EINSATZ_KEYS.verpflegung, einsatzId] as const,
  // Presse S5 (LFH-554): argumentlos = Invalidierungs-Prefix; Listen und Detail als Sub-Keys.
  presse: (einsatzId: number) => [EINSATZ_KEYS.presse, einsatzId] as const,
  medienkontakte: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'medienkontakte'] as const,
  /** Alle offenen Medienkontakte (LFH-1075). */
  medienkontakteOffen: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'medienkontakte', 'offen'] as const,
  /**
   * Seitenkette der erledigten Medienkontakte (LFH-1075); ohne `arten` zugleich der Prefix aller
   * Ketten, mit ihnen die am Server nach Art gefilterte (LLH-1096, letztes Glied `anfrage,termin`).
   */
  medienkontakteErledigt: (einsatzId: number, arten: readonly string[] = []) =>
    arten.length
      ? ([
          EINSATZ_KEYS.presse,
          einsatzId,
          'medienkontakte',
          'abgeschlossen',
          arten.join(','),
        ] as const)
      : ([EINSATZ_KEYS.presse, einsatzId, 'medienkontakte', 'abgeschlossen'] as const),
  /** Zahlen und Medien über den ganzen Bestand, Grundlage der Medienlage (LFH-1075). */
  medienkontaktKennzahlen: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'medienkontakte', 'kennzahlen'] as const,
  /** Ein Medienkontakt für den Deeplink auf eine nicht geladene Zeile (LFH-1075). */
  medienkontaktEinzeln: (einsatzId: number, kontaktId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'medienkontakte', 'einzeln', kontaktId] as const,
  medienkontaktEinzelnAlle: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'medienkontakte', 'einzeln'] as const,
  pressemitteilungen: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'mitteilungen'] as const,
  pressemitteilung: (einsatzId: number, mitteilungId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'mitteilung', mitteilungId] as const,
  // Informationstelefon (LLH-732): argumentlos = Invalidierungs-Prefix, das `infotelefon`-Ereignis
  // trifft Seitenkette, Zählung und Einzelabruf zusammen.
  infotelefon: (einsatzId: number) => [EINSATZ_KEYS.infotelefon, einsatzId] as const,
  /** Seitenkette des Protokolls je Sicht der Segmentleiste. */
  infotelefonListe: (einsatzId: number, sicht: 'alle' | 'offen') =>
    [EINSATZ_KEYS.infotelefon, einsatzId, 'liste', sicht] as const,
  /** Zahlen über den ganzen Bestand: Kennzahlen, „Nach Anliegen“, Medienlage. */
  infotelefonZaehler: (einsatzId: number) =>
    [EINSATZ_KEYS.infotelefon, einsatzId, 'zaehler'] as const,
  /** Ein Anruf für den Deeplink auf eine nicht geladene Zeile. */
  infotelefonAnruf: (einsatzId: number, anrufId: number) =>
    [EINSATZ_KEYS.infotelefon, einsatzId, 'anruf', anrufId] as const,
  /** Checkliste Arbeitsaufnahme (LFH-551), ebenfalls unter dem Stab-Prefix: kein eigenes Ereignis. */
  stabCheckliste: (einsatzId: number) => [EINSATZ_KEYS.stab, einsatzId, 'checkliste'] as const,
  /**
   * Kommunikationsplan (LFH-848), unter dem Prefix des Fernmeldewesens (LLH-1180): das
   * `fernmeldewesen`-Ereignis trifft ihn mit. Als einziger Key des Moduls ohne Netz lesbar
   * (`LAGEBILD_OFFLINE.einsatzUnterKeys`, LFH-848 design.md D9).
   */
  fernmeldewesenKommunikationsplan: (einsatzId: number) =>
    [EINSATZ_KEYS.fernmeldewesen, einsatzId, 'kommunikationsplan'] as const,
  /**
   * Daten der taktischen Fernmeldeskizze (LFH-893), unter dem Prefix des Fernmeldewesens: das
   * `fernmeldewesen`-Ereignis trifft sie mit, jede Schreibaktion des Servers sendet es. Nicht ohne
   * Netz lesbar (fehlt in `LAGEBILD_OFFLINE.einsatzUnterKeys`): bearbeitet wird die Skizze nur mit
   * Server, und der Funkplan nennt sie ohne Netz als „nicht geladen“.
   */
  fernmeldewesenSkizze: (einsatzId: number) =>
    [EINSATZ_KEYS.fernmeldewesen, einsatzId, 'skizze'] as const,

  // Dokumentenablage.
  dokumente: (einsatzId: number) => [EINSATZ_KEYS.dokumente, einsatzId] as const,

  // Bereitstellungsraum
  br: (einsatzId: number) => [EINSATZ_KEYS.br, einsatzId] as const,
  brDetail: (einsatzId: number, brId: number) => [EINSATZ_KEYS.brDetail, einsatzId, brId] as const,
  brVerlauf: (einsatzId: number, brId: number) =>
    [EINSATZ_KEYS.brVerlauf, einsatzId, brId] as const,
  brErwartet: (einsatzId: number, brId: number) =>
    [EINSATZ_KEYS.brErwartet, einsatzId, brId] as const,
  /** Ohne `suche` der Prefix aller Suchen am Raum (Invalidierung). */
  brStammTreffer: (einsatzId: number, brId: number, suche?: string) =>
    suche == null
      ? ([EINSATZ_KEYS.brStammTreffer, einsatzId, brId] as const)
      : ([EINSATZ_KEYS.brStammTreffer, einsatzId, brId, suche] as const),

  // Befehle
  befehle: (einsatzId: number) => [EINSATZ_KEYS.befehle, einsatzId] as const,
  befehl: (einsatzId: number, befehlId: number) =>
    [EINSATZ_KEYS.befehl, einsatzId, befehlId] as const,
  befehlAnlagen: (einsatzId: number, befehlId: number) =>
    [EINSATZ_KEYS.befehlAnlagen, einsatzId, befehlId] as const,

  // Kommunikation
  chatKanaele: (einsatzId: number) => [EINSATZ_KEYS.chatKanaele, einsatzId] as const,
  chatNachrichten: (einsatzId: number) => [EINSATZ_KEYS.chatNachrichten, einsatzId] as const,
  chatNachrichtenKanal: (einsatzId: number, kanalId: number | null) =>
    [EINSATZ_KEYS.chatNachrichten, einsatzId, kanalId] as const,
  erinnerungen: (einsatzId: number) => [EINSATZ_KEYS.erinnerungen, einsatzId] as const,
  /** Erinnerungen nach Phase (LFH-940): offene ungeblättert, abgeschlossene als Seitenkette. */
  erinnerungenPhase: (einsatzId: number, phase: ListenPhase) =>
    [EINSATZ_KEYS.erinnerungen, einsatzId, phase] as const,
  erinnerungKennzahlen: (einsatzId: number) =>
    [EINSATZ_KEYS.erinnerungen, einsatzId, 'kennzahlen'] as const,
  /** Vollliste ohne Phase: Sprungpalette, Chat-Bezug, Geräteseite, Übernahme. */
  meldungen: (einsatzId: number) => [EINSATZ_KEYS.meldungen, einsatzId] as const,
  /** Meldungsseite nach Phase und Richtung (LFH-940); `abgeschlossen` ist eine Seitenkette. */
  meldungenPhase: (einsatzId: number, phase: ListenPhase, richtung: string) =>
    [EINSATZ_KEYS.meldungen, einsatzId, phase, richtung] as const,
  meldungKennzahlen: (einsatzId: number, richtung: string) =>
    [EINSATZ_KEYS.meldungen, einsatzId, 'kennzahlen', richtung] as const,
  /** Einzelabruf für einen Deeplink auf eine nicht geladene Meldung. */
  meldungEinzeln: (einsatzId: number, meldungId: number) =>
    [EINSATZ_KEYS.meldungen, einsatzId, 'einzeln', meldungId] as const,
  /** Letzte Rückmeldung je Einheit/Abschnitt, unter dem `meldungen`-Prefix: jede
   *  Meldungs-Invalidierung trifft sie mit. */
  meldungenRueckmeldungen: (einsatzId: number) =>
    [EINSATZ_KEYS.meldungen, einsatzId, RUECKMELDUNGEN_SUBKEY] as const,
  lagemeldungen: (einsatzId: number) => [EINSATZ_KEYS.lagemeldungen, einsatzId] as const,
  /** Vollliste ohne Phase: Überblick, Sprungpalette, Chat, Übernahme. */
  auftraege: (einsatzId: number) => [EINSATZ_KEYS.auftraege, einsatzId] as const,
  /** Auftragsboard nach Phase, Richtung, Empfänger und Suchbegriff (LFH-1071, oxgob5gk D9);
   *  `abgeschlossen` ist eine Seitenkette. Das Meldebild liest die ungefilterte offene Liste mit:
   *  ohne Suchbegriff steht `''`, damit alle denselben Eintrag teilen. */
  auftraegePhase: (
    einsatzId: number,
    phase: ListenPhase,
    richtung: string,
    empfaenger: string,
    suche = '',
  ) => [EINSATZ_KEYS.auftraege, einsatzId, phase, richtung, empfaenger, suche] as const,
  auftragKennzahlen: (einsatzId: number, richtung: string, empfaenger: string, suche = '') =>
    [EINSATZ_KEYS.auftraege, einsatzId, 'kennzahlen', richtung, empfaenger, suche] as const,
  /** Einzelabruf für einen Deeplink auf einen nicht geladenen Auftrag. */
  auftragEinzeln: (einsatzId: number, auftragId: number) =>
    [EINSATZ_KEYS.auftraege, einsatzId, 'einzeln', auftragId] as const,
  nachforderungen: (einsatzId: number) => [EINSATZ_KEYS.nachforderungen, einsatzId] as const,
  nachforderungArten: (einsatzId: number) => [EINSATZ_KEYS.nachforderungArten, einsatzId] as const,

  // ETB
  etb: (einsatzId: number) => [EINSATZ_KEYS.etb, einsatzId] as const,
  etbListe: <F>(einsatzId: number, filter: F) => [EINSATZ_KEYS.etb, einsatzId, filter] as const,
  // Eigene Lesemarke als Sub-Key unter DEMSELBEN Prefix wie die Liste: jedes `etb`-Ereignis zieht
  // die Zahl „neu seit Ihrer letzten Sichtung“ mit.
  etbLesemarke: (einsatzId: number) => [EINSATZ_KEYS.etb, einsatzId, 'lesemarke'] as const,
  // Exakte Zählung unter demselben Prefix. Der Filter ist Teil des Keys: Kopf und Bilanz zählen
  // genau, was die Liste zeigt.
  etbZaehler: <F>(einsatzId: number, filter: F) =>
    [EINSATZ_KEYS.etb, einsatzId, 'zaehler', filter] as const,

  // Modulzähler des Navigationsrahmens
  modulZaehler: (einsatzId: number) => [EINSATZ_KEYS.modulZaehler, einsatzId] as const,
  lagemonitor: (einsatzId: number) => [EINSATZ_KEYS.lagemonitor, einsatzId] as const,

  // Abgeleitetes
  // Die gerundeten Koordinaten sind Teil des Keys (Cache-Trefferquote + serverseitiger
  // Cache-Share hängen daran) — die Rundung passiert im Aufrufer, nicht hier.
  ortVorschau: (
    einsatzId: number,
    lat: number | null,
    lon: number | null,
    exclude: string | null,
  ) => [EINSATZ_KEYS.ortVorschau, einsatzId, lat, lon, exclude] as const,
  // Der getrimmte Suchtext ist der Key: gleiche Begriffe treffen den Client-Cache (LFH-638).
  ortSuche: (einsatzId: number, begriff: string) =>
    [EINSATZ_KEYS.ortSuche, einsatzId, begriff] as const,
  einsatzortSuche: (einsatzId: number, begriff: string) =>
    [EINSATZ_KEYS.einsatzortSuche, einsatzId, begriff] as const,
  // Download-Adresse der bereinigten Fassung ist der Key: ein Anhang ändert sich nie (LFH-759).
  anhangHeicVorschau: (einsatzId: number, href: string) =>
    [EINSATZ_KEYS.anhangHeicVorschau, einsatzId, href] as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Nicht-einsatz-scoped Query-Keys
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Query-Key-Prefixe für alles, was NICHT unter einer `einsatzId` hängt. Bewusst nicht
 * `ORG_KEYS`: `admin-karte`/`karte-config` sind instanzweit, `fachebene` bezeichnet externe
 * Fremdquellen.
 *
 * Die Gliederung unten ist DOKUMENTATION. Erzwungen ist seit LFH-734 eine andere Partition:
 * jeder Key ist live über {@link ORG_STREAM_EVENTS} ODER steht in {@link NICHT_LIVE_GLOBAL_KEYS}
 * (`queryKeys.guard.test.ts`, Guard (g)).
 *
 * Die Wire-Strings sind EINGEFROREN und byte-gepinnt (`queryKeys.test.ts`): ein geänderter Key
 * bricht nichts, er trifft still ein anderes Cache-Fach.
 */
export const GLOBAL_KEYS = {
  // Mandant / Organisation
  einsaetze: 'einsaetze',
  benutzer: 'benutzer',
  organisation: 'organisation',
  orgEinstellungen: 'org-einstellungen',
  orgModulEinstellungen: 'org-modul-einstellungen',
  authProvider: 'auth-provider',
  // Präferenzen des ANGEMELDETEN Benutzers.
  benutzerEinstellungen: 'benutzer-einstellungen',
  // Versionsstand der Instanz und Lesestand der Neuigkeiten (Spec `versionsstand`).
  versionsstand: 'versionsstand',
  // Laufende Sitzungen (LFH-1092): die eigenen und die einer Person für den Admin.
  sitzungen: 'sitzungen',
  // Stand der Demo-Daten der eigenen Organisation, nur für den System-Admin; 404 heißt „nicht
  // freigeschaltet“.
  demoDaten: 'demo-daten',
  // Aufbewahrung abgeschlossener Einsätze der eigenen Organisation (Übersicht, Archivakte,
  // Archiv-ETB), nur für den System-Admin.
  aufbewahrung: 'aufbewahrung',
  // Zugangsprotokoll (LFH-1097): Anmelde- und Admin-Spur, nur für den System-Admin.
  zugangsprotokoll: 'zugangsprotokoll',

  // Stammdaten-Kataloge
  personal: 'personal',
  personalStatus: 'personal-status',
  personalVorschlaege: 'personal-vorschlaege',
  fahrzeuge: 'fahrzeuge',
  fahrzeugStatus: 'fahrzeug-status',
  fahrzeugVorschlaege: 'fahrzeug-vorschlaege',
  material: 'material',
  materialKategorien: 'material-kategorien',
  sprechgruppen: 'sprechgruppen',
  qualifikationen: 'qualifikationen',
  einheitTypen: 'einheit-typen',
  // Katalog „Einheiten-Vorlagen“ (LLH-1042). Nicht im Lagebild: im Einsatz gebildet wird nur
  // mit Netz (LLH-1049), und die Verwaltung arbeitet ohnehin online.
  einheitVorlagen: 'einheit-vorlagen',
  // Verpflegungsplan der Organisation (LLH-1058). Nicht im Lagebild: einen Tag aus der Vorlage
  // legt nur an, wer Netz hat; Zeitfenster entstehen ohne Netz nicht.
  verpflegungVorlagen: 'verpflegung-vorlagen',
  etbBausteine: 'etb-bausteine',
  stichwortVorschlaege: 'stichwort-vorschlaege',
  // Katalog „Einsatz-Vorlagen“ (LLH-1375). Nicht im Lagebild: gewählt wird eine Vorlage nur beim
  // Anlegen, und das geht nur mit Netz.
  einsatzVorlagen: 'einsatz-vorlagen',
  // Ortssuche ohne Einsatz (LFH-1175), etwa beim Anlegen. Nicht `ort-suche`: das ist der
  // Einsatz-Prefix der Lagekarte, ein gleicher Wire-String träfe dessen Fach.
  orgOrtSuche: 'org-ort-suche',
  // Ort-Vorschau ohne Einsatz (LLH-1376), aus demselben Grund nicht `ort-vorschau`.
  orgOrtVorschau: 'org-ort-vorschau',
  // Katalog „Externe Stellen“ (LFH-1194). Nicht im Lagebild: ohne Netz bleibt die meldende
  // Stelle Freitext, und Rufnummern gehören nicht ohne Not auf die Platte.
  externeStellen: 'externe-stellen',
  // Katalog der Führungsfunktionen mit Mandantenlabels (LFH-549). Nicht im Lagebild: gelesen
  // werden Snapshot und Auflösung, die im Auftrag stecken.
  fuehrungsfunktionen: 'fuehrungsfunktionen',
  // Katalog „Schichtmodelle“ (LLH-1122). Nicht im Lagebild: der Einsatz trägt seine Kopie
  // (`einsatz-abloesungen`), und gewählt wird ein Modell nur mit Netz.
  schichtmodelle: 'schichtmodelle',

  // Instanz / Betrieb — NICHT mandantenbezogen
  adminKarte: 'admin-karte',
  karteConfig: 'karte-config',
  // Datenträgerprüfung des Server-Rechners (LFH-1100), nur für den System-Admin.
  datentraeger: 'datentraeger',

  // Externe Quellen
  fachebene: 'fachebene',
} as const;

/** Ein globaler Key; nur die Lagebild-Allowlist unten braucht den Typ (LFH-723). */
type GlobalKey = (typeof GLOBAL_KEYS)[keyof typeof GLOBAL_KEYS];

/**
 * Dienstfilter der Stammdaten-Listen (`personal` / `fahrzeuge` / `material`). String-Union
 * statt boolean, weil der Wert als Key-Element auf der Wire liegt. Eingefroren: ein Umbau auf
 * ein Filter-Objekt änderte jeden Cache-Key dieser drei Listen.
 */
type Dienstfilter = 'alle' | 'im-dienst';

/** Die beiden Spuren unter dem `zugangsprotokoll`-Prefix (LFH-1097). */
export type ZugangsprotokollSpur = 'anmeldungen' | 'zugangsaenderungen';

/** Die drei adressierten Bereiche unter dem `aufbewahrung`-Prefix. */
type AufbewahrungBereich = 'akte' | 'etb' | 'antraege';

/** Die sieben Bereiche unter dem `admin-karte`-Prefix. */
type AdminKarteBereich =
  | 'katalog'
  | 'bau-status'
  | 'offline-karten'
  | 'baubare-regionen'
  | 'offline-katalog'
  | 'offline-vorhandene'
  | 'online-quellen'
  // LFH-993: Status der automatischen Aktualisierung der Offline-Karten.
  | 'aktualisierung';

/**
 * Typisierte Key-Factory für alle nicht-einsatz-scoped Queries. Wie bei {@link einsatzKeys} ist
 * der ARGUMENTLOSE Accessor zugleich der Invalidierungs-Prefix; Filter-Varianten hängen ein
 * Element an. Deshalb ZWEI Accessoren statt eines optionalen Arguments: `personal()`
 * invalidiert beide Fächer, `personalListe('alle')` adressiert genau eines.
 */
export const globalKeys = {
  // Mandant / Organisation — alle einelementig
  einsaetze: () => [GLOBAL_KEYS.einsaetze] as const,
  benutzer: () => [GLOBAL_KEYS.benutzer] as const,
  organisation: () => [GLOBAL_KEYS.organisation] as const,
  orgEinstellungen: () => [GLOBAL_KEYS.orgEinstellungen] as const,
  orgModulEinstellungen: () => [GLOBAL_KEYS.orgModulEinstellungen] as const,
  authProvider: () => [GLOBAL_KEYS.authProvider] as const,
  /**
   * Sitzungen (LFH-1092): der argumentlose Accessor ist der Invalidierungs-Prefix für beide
   * Fächer, die eigenen Sitzungen und die einer Person (für den Admin).
   */
  sitzungen: () => [GLOBAL_KEYS.sitzungen] as const,
  sitzungenEigene: () => [GLOBAL_KEYS.sitzungen, 'eigene'] as const,
  sitzungenVon: (benutzerId: number) => [GLOBAL_KEYS.sitzungen, 'benutzer', benutzerId] as const,
  demoDaten: () => [GLOBAL_KEYS.demoDaten] as const,
  /**
   * Aufbewahrung: der ARGUMENTLOSE Accessor ist Übersicht UND Invalidierungs-Prefix für Akte und
   * Archiv-ETB. Der ETB-Typfilter hängt als Token an (`'alle'` ohne Filter), nie als Objekt.
   */
  aufbewahrung: () => [GLOBAL_KEYS.aufbewahrung] as const,
  aufbewahrungAkte: (einsatzId: number) =>
    [GLOBAL_KEYS.aufbewahrung, 'akte' satisfies AufbewahrungBereich, einsatzId] as const,
  aufbewahrungEtb: (einsatzId: number, typ: EtbTyp | undefined) =>
    [
      GLOBAL_KEYS.aufbewahrung,
      'etb' satisfies AufbewahrungBereich,
      einsatzId,
      typ ?? 'alle',
    ] as const,
  /** Löschersuchen nach Art. 17 eines Einsatzes (LFH-751). */
  aufbewahrungAntraege: (einsatzId: number) =>
    [GLOBAL_KEYS.aufbewahrung, 'antraege' satisfies AufbewahrungBereich, einsatzId] as const,
  /** Prefix beider Spuren des Zugangsprotokolls. */
  zugangsprotokoll: () => [GLOBAL_KEYS.zugangsprotokoll] as const,
  /** Seitenkette einer Spur mit ihrem Filter. */
  zugangsprotokollSeiten: (
    spur: ZugangsprotokollSpur,
    filter: Readonly<Record<string, string | undefined>>,
  ) => [GLOBAL_KEYS.zugangsprotokoll, spur, filter] as const,

  // Stammdaten-Kataloge ohne Filter
  qualifikationen: () => [GLOBAL_KEYS.qualifikationen] as const,
  personalStatus: () => [GLOBAL_KEYS.personalStatus] as const,
  personalVorschlaege: () => [GLOBAL_KEYS.personalVorschlaege] as const,
  fahrzeugStatus: () => [GLOBAL_KEYS.fahrzeugStatus] as const,
  fahrzeugVorschlaege: () => [GLOBAL_KEYS.fahrzeugVorschlaege] as const,
  materialKategorien: () => [GLOBAL_KEYS.materialKategorien] as const,
  einheitTypen: () => [GLOBAL_KEYS.einheitTypen] as const,
  etbBausteine: () => [GLOBAL_KEYS.etbBausteine] as const,
  stichwortVorschlaege: () => [GLOBAL_KEYS.stichwortVorschlaege] as const,
  einsatzVorlagen: () => [GLOBAL_KEYS.einsatzVorlagen] as const,
  fuehrungsfunktionen: () => [GLOBAL_KEYS.fuehrungsfunktionen] as const,
  schichtmodelle: () => [GLOBAL_KEYS.schichtmodelle] as const,

  // Dienstfilter-Listen: barer Prefix (= Invalidierung beider Fächer) + adressiertes Fach
  personal: () => [GLOBAL_KEYS.personal] as const,
  personalListe: (filter: Dienstfilter) => [GLOBAL_KEYS.personal, filter] as const,
  fahrzeuge: () => [GLOBAL_KEYS.fahrzeuge] as const,
  fahrzeugeListe: (filter: Dienstfilter) => [GLOBAL_KEYS.fahrzeuge, filter] as const,
  material: () => [GLOBAL_KEYS.material] as const,
  materialListe: (filter: Dienstfilter) => [GLOBAL_KEYS.material, filter] as const,
  // sprechgruppen kennt nur den Filterwert 'alle', deshalb nur dieser eine Accessor (siehe
  // queryKeys.prefixmatch.test.ts). Den baren Prefix invalidiert `stammdaten` (LFH-734).
  sprechgruppenAlle: () => [GLOBAL_KEYS.sprechgruppen, 'alle'] as const,
  /**
   * Externe Stellen (LFH-1194): `'aktiv'` für die Vorschläge, `'alle'` für die Verwaltung. Der
   * argumentlose Accessor ist der Invalidierungs-Prefix beider Fächer.
   */
  externeStellen: () => [GLOBAL_KEYS.externeStellen] as const,
  externeStellenListe: (umfang: 'aktiv' | 'alle') => [GLOBAL_KEYS.externeStellen, umfang] as const,
  /**
   * Einheiten-Vorlagen (LLH-1042): `'alle'` für die Verwaltung, `'aktiv'` für das Bilden im
   * Einsatz (LLH-1049). Der argumentlose Accessor ist der Invalidierungs-Prefix beider Fächer.
   */
  einheitVorlagen: () => [GLOBAL_KEYS.einheitVorlagen] as const,
  einheitVorlagenListe: (scope: 'aktiv' | 'alle') => [GLOBAL_KEYS.einheitVorlagen, scope] as const,
  // Verpflegungsplan (LLH-1058): die Verwaltung liest `'alle'`, der Tag aus der Vorlage `'aktiv'`;
  // `stammdaten` invalidiert den baren Prefix und damit beide Fächer.
  verpflegungVorlagen: () => [GLOBAL_KEYS.verpflegungVorlagen] as const,
  verpflegungVorlagenListe: (scope: 'aktiv' | 'alle') =>
    [GLOBAL_KEYS.verpflegungVorlagen, scope] as const,

  /**
   * Präferenzen EINES Benutzers. Der Server-Slot ist pro Benutzer, sein Cache-Fach muss es auch
   * sein: `main.tsx` hält EINEN QueryClient für die Lebensdauer des Tabs, und am gemeinsamen
   * Fükw-Rechner sähe sonst die zweite Schicht das Gedächtnis der ersten und schriebe es in ihr
   * eigenes Serverfach zurück. Beim Abmelden zu räumen geht nicht: es gibt keinen solchen
   * Mechanismus, und eine Sitzung kann ohne Abmeldung enden (401).
   *
   * `null` heißt „niemand angemeldet“; das Fach bleibt leer, weil die Abfrage dann abgeschaltet
   * ist. KEIN barer Prefix-Accessor daneben. Die Bindung an die Id bleibt, obwohl `logout()`
   * seit LFH-723 den Cache räumt: sie hängt nicht daran, dass jeder Weg hinaus dort durchläuft.
   */
  benutzerEinstellungenVon: (benutzerId: number | null) =>
    [GLOBAL_KEYS.benutzerEinstellungen, benutzerId] as const,
  versionsstand: () => [GLOBAL_KEYS.versionsstand] as const,

  // Karte: barer Prefix (invalidiereKarte trifft alle sieben Bereiche) + adressierter Bereich.
  datentraeger: () => [GLOBAL_KEYS.datentraeger] as const,
  adminKarte: () => [GLOBAL_KEYS.adminKarte] as const,
  adminKarteBereich: (bereich: AdminKarteBereich) => [GLOBAL_KEYS.adminKarte, bereich] as const,
  karteConfig: () => [GLOBAL_KEYS.karteConfig] as const,
  orgOrtSuche: (begriff: string) => [GLOBAL_KEYS.orgOrtSuche, begriff] as const,
  // Gerundete Koordinaten wie `einsatzKeys.ortVorschau`; die Rundung passiert im Aufrufer.
  orgOrtVorschau: (lat: number | null, lon: number | null) =>
    [GLOBAL_KEYS.orgOrtVorschau, lat, lon] as const,

  // Externe Fachebenen. `kritis` und `energie` tragen eine BBox im Key und haben einen eigenen
  // Accessor, sonst entstünden zwei Cache-Fächer für denselben Zustand. `bbox` ist
  // `string | null`, NICHT `undefined`.
  fachebene: (quelle: Exclude<FachebeneQuelle, 'kritis' | 'energie'>) =>
    [GLOBAL_KEYS.fachebene, quelle] as const,
  fachebeneKritis: (bbox: string | null) => [GLOBAL_KEYS.fachebene, 'kritis', bbox] as const,
  fachebeneEnergie: (bbox: string | null) => [GLOBAL_KEYS.fachebene, 'energie', bbox] as const,
} as const;

/**
 * Org-Ereignis (SSE `type`, LFH-734) → die globalen Prefixe, die es invalidiert. Wie bei
 * {@link EINSATZ_STREAM_EVENTS} beantwortet die Liste „welcher Cache könnte stale sein", nicht
 * „wer darf es erfahren" (das entscheidet der Server). Invalidiert wird der EINSTELLIGE Prefix
 * `[key]`, er trifft auch die Filter-Fächer (`personalListe('alle')`). Ohne aktiven Beobachter
 * wird nur markiert, nicht abgerufen; die Admin-Listen kosten Nicht-Admins deshalb nichts.
 *
 * Beide Ereignisse kommen über den Einsatz-Strom oder, außerhalb eines Einsatzes, über den
 * Org-Strom `/api/live` (`live/orgListener.ts`). Kontrakt gegen das Rust-`OrgLiveEvent`:
 * `orgLiveEvent.contract.test.ts`.
 */
export const ORG_STREAM_EVENTS = {
  // Die Liste samt Switcher und Sprungpalette, dazu die Admin-Listen, deren Zeilen an Einsätzen
  // hängen (Demo-Stand, Aufbewahrung).
  einsatzliste: [GLOBAL_KEYS.einsaetze, GLOBAL_KEYS.demoDaten, GLOBAL_KEYS.aufbewahrung],
  stammdaten: [
    GLOBAL_KEYS.personal,
    GLOBAL_KEYS.personalStatus,
    GLOBAL_KEYS.personalVorschlaege,
    GLOBAL_KEYS.fahrzeuge,
    GLOBAL_KEYS.fahrzeugStatus,
    GLOBAL_KEYS.fahrzeugVorschlaege,
    GLOBAL_KEYS.material,
    GLOBAL_KEYS.materialKategorien,
    GLOBAL_KEYS.sprechgruppen,
    GLOBAL_KEYS.qualifikationen,
    GLOBAL_KEYS.einheitTypen,
    GLOBAL_KEYS.einheitVorlagen,
    GLOBAL_KEYS.verpflegungVorlagen,
    GLOBAL_KEYS.etbBausteine,
    GLOBAL_KEYS.stichwortVorschlaege,
    GLOBAL_KEYS.einsatzVorlagen,
    GLOBAL_KEYS.externeStellen,
    GLOBAL_KEYS.fuehrungsfunktionen,
    GLOBAL_KEYS.schichtmodelle,
    GLOBAL_KEYS.organisation,
    // Die Liste zeigt den Namen der Organisation und Labels der Führungsfunktionen.
    GLOBAL_KEYS.einsaetze,
  ],
} as const satisfies Record<string, readonly GlobalKey[]>;

export type OrgStreamEvent = keyof typeof ORG_STREAM_EVENTS;

/** Alle live geführten globalen Prefixe, dedupliziert — der Vollabgleich nach `lagged` und
 *  nach jedem Wiederaufbau einer Live-Verbindung. */
export const ORG_LIVE_KEYS: readonly GlobalKey[] = [
  ...new Set(Object.values(ORG_STREAM_EVENTS).flat()),
];

/**
 * Globale Keys, die BEWUSST kein Org-Ereignis auffrischt (Spec `org-live`, „Bewusst nicht
 * live"). `queryKeys.guard.test.ts` verlangt, dass jeder Key aus {@link GLOBAL_KEYS} entweder in
 * {@link ORG_STREAM_EVENTS} auftaucht ODER hier steht.
 *
 * - `benutzer`, `authProvider`: Benutzerverwaltung und Anmeldewege, nur für den Admin.
 * - `orgEinstellungen`, `orgModulEinstellungen`: enger Lesekreis; ein Modulwechsel wirkt auf den
 *   Rechte-Schnappschuss der Einsatz-Ströme und ist ein eigenes Thema.
 * - `benutzerEinstellungen`: Präferenzen des angemeldeten Benutzers, nur er schreibt sie.
 * - `sitzungen`: Anmeldungen einer Person, gelesen beim Öffnen und nach dem Beenden.
 * - `adminKarte`, `karteConfig`, `datentraeger`: instanzweit, nicht mandantenbezogen.
 * - `fachebene`: externe Quellen mit eigener Nachfrage.
 * - `zugangsprotokoll`: geladen beim Öffnen und bei Filterwechsel, nie live (LFH-1097).
 * - `orgOrtSuche`: Adresssuche auf Enter wie `ortSuche` (LFH-1175); nie live, nie offline (der
 *   Suchtext kann eine Personenadresse sein).
 * - `orgOrtVorschau`: abgeleiteter Geo-Lookup wie `ortVorschau` (LLH-1376); live zu invalidieren
 *   wäre schädlich (Nominatim-ToS).
 */
export const NICHT_LIVE_GLOBAL_KEYS = [
  GLOBAL_KEYS.benutzer,
  GLOBAL_KEYS.authProvider,
  GLOBAL_KEYS.orgEinstellungen,
  GLOBAL_KEYS.orgModulEinstellungen,
  GLOBAL_KEYS.benutzerEinstellungen,
  GLOBAL_KEYS.versionsstand,
  GLOBAL_KEYS.sitzungen,
  GLOBAL_KEYS.adminKarte,
  GLOBAL_KEYS.karteConfig,
  GLOBAL_KEYS.datentraeger,
  GLOBAL_KEYS.fachebene,
  GLOBAL_KEYS.zugangsprotokoll,
  GLOBAL_KEYS.orgOrtSuche,
  GLOBAL_KEYS.orgOrtVorschau,
] as const satisfies readonly GlobalKey[];

/**
 * Was vom Lagebild ohne Netz lesbar bleibt (LFH-723, design.md D3) — die EINE Quelle für
 * „was darf auf die Platte".
 *
 * Sie steht hier und nicht im Persister, damit Invalidierung, SSE-Fan-out und Vorhaltung über
 * dieselben Keys sprechen: ein URL-Cache daneben wäre eine zweite Wahrheit ohne Invalidierung
 * und ohne Benutzerbindung. Gelistet sind die fünf Ansichten ETB, Meldebild, Betroffene,
 * Aufträge und Lagekarte sowie die Rahmendaten, ohne die sie nicht rendern (Einsatzkopf,
 * Freigaben, Einstellungen, Zähler, Einsatzliste, Kartenkonfiguration, Organisation,
 * Fahrzeugstatus-Katalog), die Präferenzen der Person (Standard-Rufname, LFH-894) und der
 * Verlauf ihrer Benachrichtigungen (LLH-1422). Von den Meldungen nur die Rückmeldungen, nicht die
 * Liste.
 *
 * Bewusst draußen: Druck (ein Schnappschuss), Personen-Audit samt Listenzugriffen der
 * Personenliste (LFH-916, nur für die Einsatzleitung), die Auswahl „Bestätigt von“ am Gerät
 * (LFH-1046, Geräte speichern nichts), die Personenauswahl im Zugriff (LFH-1141: Namen der Org,
 * und ohne Netz nimmt niemand jemanden auf), Chat, Dokumente, die
 * Anhanglisten der Erfassungsmodule samt UHS-Zugriffsprotokoll (LFH-21/LFH-758: ohne Netz lädt
 * keine Datei, und Dateinamen an einer UHS können Patienten nennen), HEIC-Vorschau
 * (Object-URLs, nur im Speicher, LFH-759),
 * Snapshot-Dokumente, Pegel, Wetter, Fremdquellen, Org-Einstellungs- und Admin-Keys samt der
 * Modul-Vorgaben am Einsatz (LLH-1183, nur der Editor liest sie, wie die Overrides), die eigene
 * Führungsstelle (LFH-849: Telefon und Verbindungen sind personenbezogen), der
 * Funktionskatalog (LFH-549: Aufträge tragen Snapshot und Auflösung selbst), die externen
 * Stellen (LFH-1194: ohne Netz bleibt die meldende Stelle Freitext; Rufnummern), die
 * Schichtmodelle (LLH-1122: der Einsatz trägt seine Kopie), dazu S5
 * (Presse-Log, Pressemitteilungen, Informationstelefon: Kontaktdaten und Rückrufnummern,
 * LFH-554 design.md D8, offen mit LFH-767), die Daten der Fernmeldeskizze (LFH-893: bearbeitet
 * nur mit Server; der Funkplan nennt sie ohne Netz „nicht geladen“), die Bild-Anlagen an
 * Lagebericht und Befehl (LFH-1028: ohne Netz lädt kein Bild), die Tierliste und mit ihr die
 * Kartenebene „Tiere" (LLH-1123: sie trägt Halterkontakt und Kennzeichnung; ohne Netz zeigt die
 * Karte keine Tiere, wie keine Bereitstellungsräume) und die Vorgabe je Funktion (LLH-1421: nur
 * die Einstellungsseite liest sie, geschrieben wird mit Netz).
 * `lagebildOffline.guard.test.ts` vergleicht die Liste mit JEDEM verwalteten Prefix.
 */
export const LAGEBILD_OFFLINE = {
  einsatz: [
    // Rahmen. Freigaben statt Overrides (LFH-669): ohne sie lädt keine Seite die Daten eines
    // fremden Moduls; die Overrides liest nur noch der Editor (Einstellungs-Key, draußen).
    EINSATZ_KEYS.einsatz,
    EINSATZ_KEYS.modulFreigaben,
    EINSATZ_KEYS.einstellungen,
    EINSATZ_KEYS.modulZaehler,
    // ETB — nur in seinen festen Ansichten ({@link istFesteEtbAnsicht}, LFH-939 D4). Ergebnisse
    // freier Eingaben (Volltext, Zeitraum, Einheit, Nummernsprung der Palette, Bezugssuche)
    // filtert `istLagebildOfflineKey` heraus; ihr kurzes `gcTime` setzt `api/queryClient.ts`.
    EINSATZ_KEYS.etb,
    // Meldebild
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.material,
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.auftraege,
    // Spalte „Im Einsatz" (LFH-552)
    EINSATZ_KEYS.kraefteZeitachse,
    // Aufträge
    EINSATZ_KEYS.befehle,
    // Betroffene — ohne Freitexte und Fundort (LFH-1095, `offline/lagebildKuerzung.ts`).
    EINSATZ_KEYS.personen,
    // Auswahl ohne Freitexte (LFH-940, D8): hält die Personensuche der Palette ohne Netz.
    EINSATZ_KEYS.personenAuswahl,
    // Vorschläge zum Rettungsmittel (LLH-1332): die Verbleib-Maske merkt ohne Netz vor.
    EINSATZ_KEYS.personenTransportmittel,
    EINSATZ_KEYS.uhs,
    // Lagekarte
    EINSATZ_KEYS.zonen,
    EINSATZ_KEYS.freieZeichen,
    EINSATZ_KEYS.gefahrengebiete,
    EINSATZ_KEYS.schaeden,
    EINSATZ_KEYS.schadenMarker,
    EINSATZ_KEYS.lagemeldungen,
    EINSATZ_KEYS.fuehrungskraefte,
    EINSATZ_KEYS.betreuung,
    EINSATZ_KEYS.evakuierung,
    EINSATZ_KEYS.kartenAnsicht,
    EINSATZ_KEYS.kartenbilder,
    EINSATZ_KEYS.lageSnapshot,
    // Verlauf der eigenen Benachrichtigungen (LLH-1422): ohne Netz lesbar, „Alle gelesen“ wird
    // vorgemerkt (`offline/schreiben.ts`). Die Detailzeile liest der Server nur aus Retain-Spalten
    // (Nummern, Labels; `src/benachrichtigung/text.rs`), Freitexte stehen nicht darin.
    EINSATZ_KEYS.benachrichtigungVerlauf,
  ],
  /** Einzelne Sub-Keys eines sonst ungelisteten Prefix: `[prefix, einsatzId, sub]`. */
  einsatzUnterKeys: [
    [EINSATZ_KEYS.meldungen, 'rueckmeldungen'],
    // Kommunikationsplan (LFH-848, design.md D9): die Telefonliste wird gebraucht, wenn der Server
    // weg ist. Die Skizze unter demselben Prefix bleibt draußen (LLH-1180: Prefix des
    // Fernmeldewesens; der Stab hat nichts mehr offline).
    [EINSATZ_KEYS.fernmeldewesen, 'kommunikationsplan'],
  ],
  global: [
    GLOBAL_KEYS.einsaetze,
    GLOBAL_KEYS.karteConfig,
    GLOBAL_KEYS.organisation,
    GLOBAL_KEYS.fahrzeugStatus,
    // Präferenzen der Person (LFH-894): ohne den Standard-Rufnamen hielte die Von/An-Pflicht
    // jede Erfassung nach einem Kaltstart ohne Server auf. Das Fach trägt sonst nur das
    // Palettengedächtnis; der Datensatz ist an die Person gebunden und geht beim Abmelden.
    GLOBAL_KEYS.benutzerEinstellungen,
  ],
} as const satisfies {
  einsatz: readonly EinsatzKey[];
  einsatzUnterKeys: readonly (readonly [EinsatzKey, string])[];
  global: readonly GlobalKey[];
};

const LAGEBILD_EINSATZ: ReadonlySet<unknown> = new Set<unknown>(LAGEBILD_OFFLINE.einsatz);
const LAGEBILD_GLOBAL: ReadonlySet<unknown> = new Set<unknown>(LAGEBILD_OFFLINE.global);

/**
 * Filterfelder, die eine FESTE ETB-Ansicht ergeben (LFH-939, design.md D4): Gesamtliste, je ein
 * Reiter je Typ, feste Ausschnitte (Überblick, Lage-Dashboard, Bezugswahl ohne Suche). Ihre Menge
 * ist begrenzt. Eine Positivliste statt einer Negativliste: ein neues Filterfeld landet nicht
 * still auf der Platte, es muss hier aufgenommen werden.
 */
const ETB_FESTE_FILTERFELDER: ReadonlySet<string> = new Set(['typ', 'limit']);

/**
 * Ist dieser ETB-Key eine feste Ansicht? Liste (`['etb', id, filter]`), Zähler
 * (`['etb', id, 'zaehler', filter]`) und Lesemarke. Alles mit einer freien Eingabe (Volltext,
 * Zeitraum, Einheit, Nummernsprung, Bezugssuche, Lageentwicklung) ist es nicht.
 */
export function istFesteEtbAnsicht(key: readonly unknown[]): boolean {
  if (key[0] !== EINSATZ_KEYS.etb || typeof key[1] !== 'number') return false;
  if (key.length === 2 || key[2] === 'lesemarke') return true;
  const filter = key[2] === 'zaehler' ? key[3] : key[2];
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return false;
  return Object.entries(filter).every(
    ([feld, wert]) => wert === undefined || ETB_FESTE_FILTERFELDER.has(feld),
  );
}

/** Gehört der Key zur Allowlist {@link LAGEBILD_OFFLINE}? Einsatz-Keys verlangen an Stelle 1
 *  eine Einsatz-ID, wie jeder Accessor von {@link einsatzKeys} sie setzt. */
export function istLagebildOfflineKey(key: readonly unknown[]): boolean {
  if (LAGEBILD_GLOBAL.has(key[0])) return true;
  if (typeof key[1] !== 'number') return false;
  if (key[0] === EINSATZ_KEYS.etb) return istFesteEtbAnsicht(key);
  if (LAGEBILD_EINSATZ.has(key[0])) return true;
  return LAGEBILD_OFFLINE.einsatzUnterKeys.some(
    ([prefix, unter]) => key[0] === prefix && key[2] === unter,
  );
}
