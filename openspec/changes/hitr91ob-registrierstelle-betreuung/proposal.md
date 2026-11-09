## Why

Wer eine Notunterkunft betreibt, muss wissen, wer dort ist und wer welches Essen braucht. Heute
zählt die Betreuungsstelle ihre Belegung nur als Zahl. Personen lassen sich zwar als Betroffene
mit Verbleib „Notunterkunft“ führen, aber nicht schnell an der Tür aufnehmen, nicht als Familie
und ohne Essenspräferenz. Die Verpflegung bekommt deshalb nur die Gesamtzahl vorgeschlagen und
muss die Sonderkost schätzen (Zunder LLH-1612).

## What Changes

- **Registrierstelle an der Betreuungsstelle:** Auf der Detailseite der Stelle und am Gerät
  „Betreuungsstelle“ gibt es „Registrieren“. Eine kompakte Maske nimmt einen Haushalt in einem
  Zug auf, ohne etwas einzuklappen: oben einmal Herkunftsadresse und Kontakt des Haushalts,
  darunter je Person eine Zeile mit Nachname (Pflicht), Vorname, Geburtsdatum, Geschlecht,
  Kostform (Pflicht, „Normalkost“ vorgewählt) und Unverträglichkeiten. „Person hinzufügen“
  übernimmt den Nachnamen. Alle Felder sind beschriftet und per Tastatur erreichbar. Ein
  Speichern legt alle Personen als Betroffene mit Verbleib „Notunterkunft“ an dieser Stelle an,
  auch ohne Netz.
- **Haushalt:** Personen, die zusammen ankommen, bilden einen Haushalt mit Nummer („H-7“) und
  einer Bezugsperson. Weitere Personen lassen sich später anhängen, abgemeldet wird ein
  Haushalt ganz oder einzeln.
- **Kostform an der Person:** genau eine aus Normalkost, vegetarisch, vegan, ohne Schwein,
  Diät/allergenarm, Säugling/Kleinkind (derselbe Satz wie die Sonderkost der Verpflegung), dazu
  Freitext „Unverträglichkeiten“. Beides lässt sich auf der Personen-Detailseite feldweise
  ändern.
- **Registrierliste der Stelle:** Haushalte mit ihren Personen, ein Band „Kostformen“ mit den
  Zahlen je Kostform und „Abmelden“ (Verbleib „entlassen“ mit optionalem Ziel).
- **Belegungsart je Stelle:** „gezählt“ (wie heute, Belegung wird gemeldet) oder „namentlich
  geführt“. Bei namentlich geführten Stellen schreibt der Server die Belegungsmeldung selbst,
  sobald sich die Zahl der dort registrierten Personen ändert; eine Handmeldung wird abgelehnt.
  Kopfzahl, Belegungslinie, Meldeverlauf und Verpflegung lesen weiter dieselbe Belegung.
- **Sonderkost-Vorschlag in der Verpflegung:** Beim Anlegen eines Zeitfensters werden die
  Sonderkost-Felder aus den Kostformen der Registrierten vorbelegt, beschriftet und
  überschreibbar, ohne Personenbezug.
- **Nicht:** keine Personenauskunft und kein Suchdienst, kein Druck von Registrierkarten oder
  Bändchen, keine Zimmer- oder Bettenzuordnung, kein eigener Kostform-Katalog der Organisation.
  Die Kräfte-Unterkunft bleibt außen vor (Spec `stab-versorgung`).

## Capabilities

### New Capabilities

- `betreuung-registrierung`: Registrierung von Personen und Haushalten an einer
  Betreuungsstelle, Kostform und Unverträglichkeiten an der Person, Registrierliste,
  Abmelden, Kostform-Zählung ohne Personenbezug, Rechte und Gerät.

### Modified Capabilities

- `betreuung-evakuierung`: Die Betreuungsstelle bekommt die Belegungsart („gezählt“ oder
  „namentlich“). „Belegung melden“ lehnt Handmeldungen an namentlich geführten Stellen ab und
  kennt die vom Server geschriebene Meldung.
- `kraefte-verpflegung`: „Bedarfsvorschläge aus Personal und Betreuung“ bekommt den
  Sonderkost-Vorschlag aus den Kostformen der Registrierten.

## Impact

- **Backend:** Migration 0305 (Tabelle `haushalt`; an `einsatz_person` die Spalten
  `haushalt_id`, `kostform`, `unvertraeglichkeiten`; an `betreuungsstelle` die Spalte
  `belegungsart`; an `betreuungsstelle_belegung` die Spalte `quelle`). Neue Routen unter
  `…/betreuung/` (Registrierung, Haushalte, Abmelden, Kostformen) in `src/routes/betreuung.rs`,
  Fachcode in `src/betreuung/`, Nachführen der Belegung aus `src/person/verbleib_repo.rs` und
  dem Personen-Storno. Gerät „Betreuungsstelle“: Allow-Liste in `src/geraet/mod.rs`.
  Typ-Codegen für die neuen DTOs und Enums.
- **Frontend:** `frontend/src/betreuung/` (Maske, Registrierliste, Kostform-Band,
  Belegungsart in den Stammdaten der Stelle), `pages/BetreuungsstelleDetailPage.tsx`, die
  Geräteansicht der Betreuungsstelle, `personen/Personendaten.tsx` (Kostform,
  Unverträglichkeiten, Haushalt), `verpflegung/useBedarfsvorschlag.ts` und
  `VerpflegungDialoge.tsx`, Offline-Schreibweg `offline/schreiben.ts` (neue Art
  `registrierung`).
- **Daten und Recht:** Unverträglichkeiten sind Gesundheitsangaben: Aufbewahrungskategorie
  „Behandlung“, Schwärzung leert sie, nie im ETB, nie im Lagestand.
- **Regeln und Doku:** `frontend/src/betreuung/AGENTS.md`, Anwenderkapitel zur Betreuung und
  zur Verpflegung samt Bildern.
