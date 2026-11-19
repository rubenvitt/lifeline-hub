# Ein Rollen-Vokabular mit Kurzbeschreibung (LLH-1818)

Zunder: https://zunder.rubeen.dev/#/aufgabe/zlzpieaqevkovh5k8hi99tkp · Epic LLH-1811, Welle 2
„Rollen“ (vor LLH-1817 „Mitarbeit“ und LLH-1819 „Sackgassen nennen den Ansprechpartner“).
Route `entwurf` (E1 Entscheidung, E2 Regel). Nur Frontend und Anwenderdoku, kein Backend, keine
Wire-Änderung.

## Absicht

Drei Begriffsreihen stehen nebeneinander: der Reiter „Zugriff“ (Einsatzleitung, Führungspersonal,
Beobachter), die Modulsperre (Frei, Führung im Einsatz, Führungskraft der Organisation, Admin) und
der Benutzerdialog („System-Rolle“, „Org-Rolle“; Werte Admin/Benutzer, Führungskraft/Keine).
Dieselbe Rolle trägt mehrere Namen („Admin“, „System-Admin“, „Org-Admin“; „Führungskraft“,
„Führungskraft (darf Einsätze anlegen)“, „Führungskraft der Organisation“), und nirgends in der
App steht, was eine Rolle darf. Wer eine Rolle vergibt, soll an der Auswahl sehen, was er damit
erlaubt, und überall denselben Namen lesen.

**Ziele**

- Ein Name je Rolle, überall: Auswahlfelder, Marken, Gründe „Nur Ansicht · …“, Zugangsprotokoll,
  Profil, Benutzermenü, Anwenderdoku.
- Je Rolle ein kurzer Darf-Text, sichtbar ohne Hover als zweite Zeile in jedem Auswahlfeld, das
  eine Rolle vergibt.
- Eine Quelle im Code; ein Wächter verhindert, dass Rollennamen wieder als Literale entstehen.

**Nicht-Ziele**

- Keine neue Rolle (das ist LLH-1817), keine Änderung an Rechten oder Server-Prüfungen.
- Keine Ansprechpartner in Sackgassen (LLH-1819).
- Keine Umbenennung von Wire-Werten (`keiner`, `fuehrungskraft`, `einsatzfuehrung` …), Spalten
  oder gespeicherten Schlüsseln (`AGENTS.md`, Bezeichner-Sprache, „Grenzwerte bleiben“).
- Fehlermeldungen des Servers bleiben, wie sie sind.

**Anti-Ziel:** Darf-Texte, die zu Erklärsätzen anwachsen. Sie bleiben wenige Wörter, nennen den
Umfang, nicht die Bedienung.

## Abgestimmte Entscheidungen (Checkpoint 19.11.2026)

| Frage | Entscheidung |
| --- | --- |
| Ort des Darf-Texts | zweite Zeile im Auswahlfeld (Option und gewählter Wert zeigen nur den Namen, die aufgeklappte Liste Name + Darf-Zeile) |
| Name des Admins | „System-Admin“ überall; wo es auf die Organisation des Einsatzes ankommt „System-Admin der Organisation“ (ersetzt „Org-Admin“) |
| Name der Org-Rolle | „Führungskraft der Organisation“ überall, auch auf Marken in Benutzermenü und Benutzerliste |
| Feldnamen | „Rolle in der Verwaltung“, „Rolle in der Organisation“, „Rolle im Einsatz“ (ersetzt „System-Rolle“, „Org-Rolle“, „Rolle“ im Reiter Zugriff) |

## Ansätze

1. **Eine Vokabular-Datei mit Records je Rollenart (gewählt).** `frontend/src/einsatz/
   rollenVokabular.ts` hält `Record<EinsatzRolle, RollenBegriff>`, `Record<OrgRolle, …>`,
   `Record<SystemRolle, …>` und `Record<BenoetigteRolle | 'frei', …>` mit `{ name, darf }`.
   Bestehende Konstanten (`EINSATZ_ROLLE_LABELS`, `ROLLEN_OPTIONEN`, `SYSTEM_ROLLE_TEXT`,
   `ORG_ROLLE_TEXT`, Gründe in `nurAnsicht.ts`) leiten sich daraus ab oder verschwinden. Der
   `Record` bricht den Build, sobald der Typ-Codegen eine Rolle ergänzt (LLH-1817), statt still den
   Rohwert zu zeigen. Ein Ort, prüfbar, kleiner Diff an den Aufrufern.
2. **Namen in den vier bestehenden Dateien angleichen, Darf-Texte daneben.** Weniger Umbau, aber
   die Namensgleichheit hält nur, solange jeder daran denkt — genau die Lage, die zum Befund
   geführt hat. Verworfen.
3. **Rollentexte aus dem Backend liefern.** Eine Quelle auch für Server-Meldungen, aber Wire-
   Änderung, Typ-Codegen und Backend-Diff für reine Bedientexte. Verworfen (unverhältnismäßig).

## Vokabular

Darf-Texte sind Vorschläge des Entwurfs; Wortlaut am Ende im Review des Menschen.

**Rolle im Einsatz** (`EinsatzRolle`)

| Wert | Name | Darf |
| --- | --- | --- |
| `einsatzleitung` | Einsatzleitung | schreibt überall, verwaltet Zugriff und Geräte |
| `fuehrungspersonal` | Führungspersonal | schreibt in Modulen, Kopfdaten und Einstellungen |
| `beobachter` | Beobachter | liest nur |

**Rolle in der Organisation** (`OrgRolle`)

| Wert | Name | Darf |
| --- | --- | --- |
| `keine` | Keine | nur Einsätze, in die sie aufgenommen ist |
| `fuehrungskraft` | Führungskraft der Organisation | legt Einsätze an, liest jeden Einsatz der Organisation |

**Rolle in der Verwaltung** (`SystemRolle`)

| Wert | Name | Darf |
| --- | --- | --- |
| `keiner` | Keine | keine Verwaltung |
| `admin` | System-Admin | verwaltet Benutzer, Stammdaten und Einstellungen, liest jeden Einsatz |

**Modulsperre** (`BenoetigteRolle`, leer = frei)

| Wert | Name | Darf (wer öffnet das Modul) |
| --- | --- | --- |
| frei | Frei (alle) | alle, die den Einsatz sehen |
| `einsatzfuehrung` | Führung im Einsatz | Einsatzleitung, Führungspersonal, Führungskraft der Organisation, System-Admin |
| `fuehrungskraft` | Führungskraft der Organisation | nur Führungskraft der Organisation und System-Admin |
| `admin` | System-Admin | nur System-Admin |

Der Darf-Text der Modulsperre folgt Spec `modul-freigabe` (Archiv), Requirement „Die Rollensperre
‚Führung im Einsatz‘ bezieht die Einsatzrolle ein“. Ob „Mitarbeit“ die Stufe passiert, entscheidet
LLH-1817 und ergänzt dann diese Zeile.

**Ohne Rolle:** Wo bisher die Marke „Benutzer“ stand (Benutzerliste, Profil), steht „Keine
Rolle“ — „Benutzer“ ist kein Rollenname mehr (Entscheidung des Entwurfs, folgt aus „Keine“ in
beiden Feldern).

**Gründe** (`components/nurAnsicht.ts`): „nur System-Admin“ bleibt; „… oder Org-Admin“ wird
„… oder System-Admin der Organisation“. Die Gründe setzen sich aus den Namen des Vokabulars
zusammen, nicht aus eigenen Literalen.

## Darstellung

- **Auswahlfelder** (Reiter Zugriff: Rollen-Select beim Aufnehmen und je Zeile; Benutzerdialog
  Anlegen und Bearbeiten: beide Rollenfelder; Modul-Einstellungen: Stufe je Modul) bekommen einen
  gemeinsamen Baustein, etwa `rollenOptionen(record)` mit `optionRender`: Name in normaler Schrift,
  darunter die Darf-Zeile klein in `colorTextSecondary`. Der gewählte Wert im geschlossenen Feld
  zeigt nur den Namen (`labelRender` bzw. `label` = Name), damit schmale Spalten
  (`ModulEinstellungsListe`) nicht wachsen.
- Die Filterliste am Spaltenkopf „Rolle“ zeigt nur Namen.
- Marken (Benutzermenü, Benutzerliste, Einsatzliste „Deine Rolle: …“, Profil) zeigen nur den Namen.
- Zugangsprotokoll: „Rolle in der Verwaltung: Keine → System-Admin, Rolle in der Organisation:
  Keine → Führungskraft der Organisation“.

## Regel und Wächter

- **Regel** in `frontend/AGENTS.md`, Abschnitt „Begriffe“ (nicht in `openspec/`, eingefroren):
  Rollennamen und Darf-Texte kommen nur aus `einsatz/rollenVokabular.ts`; Auswahlfelder, die eine
  Rolle vergeben, zeigen die Darf-Zeile. Dazu eine benannte Ausnahme in „Texte: zeigen statt
  erklären“: die Darf-Zeile einer Rollenoption ist erlaubt (Umfang in wenigen Wörtern, keine
  Bedienung).
- **Wächter** `einsatz/rollenVokabular.guard.test.ts`: sucht in `frontend/src/**/*.{ts,tsx}`
  (ohne Tests, ohne `types.generated.ts`, ohne die Vokabular-Datei) sichtbare String-Literale und
  JSX-Texte mit „System-Rolle“, „Org-Rolle“, „Org-Admin“, „Führungskraft (darf“ und dem
  alleinstehenden Wort „Führungskraft“ als Rollenname (`wort="Führungskraft"`, `>Führungskraft<`,
  `'Führungskraft'`). Kommentare zählen nicht. „Führungskraft“ der Lagekarte (DV 102,
  `taktischesZeichen.ts`, `fachobjektZeichen.ts`) steht nur in Kommentaren und fällt nicht
  darunter; wo nötig eine kleine Ausnahmeliste mit Begründung.
- Ein Test je Record prüft, dass jeder Darf-Text gesetzt ist und unter einer Längengrenze bleibt
  (80 Zeichen), damit das Anti-Ziel prüfbar ist.

## Doku

Mitänderungsregel `docs/anwender/AGENTS.md`: `rechte-im-einsatz.md` (Abschnitt „Was die Rollen
dürfen“ mit denselben Darf-Texten, „Ohne Rolle im Einsatz“), `benutzer.md` (Feldnamen,
„Rollen“), `einsatz-einstellungen.md` (Modulsperre), dazu jedes Kapitel, das „Org-Rolle“,
„System-Rolle“ oder „Admin“ als Rollennamen nennt. Bilder, die die geänderten Felder zeigen,
laufen im Bildlauf neu. Quellenlisten (`quellen:`) bekommen `frontend/src/einsatz/rollenVokabular.ts`.

## Dem Bauenden überlassen

- Genauer Zuschnitt des Options-Bausteins (Funktion oder Komponente), solange alle Rollen-Selects
  ihn nutzen.
- Ob `EINSATZ_ROLLE_LABELS`/`ROLLEN_OPTIONEN` als Ableitungen bleiben oder die Aufrufer direkt auf
  das Vokabular umziehen (Bezeichner-Regel: neue Namen englisch für Technik, `rollenVokabular`
  bleibt als Fachbegriff).
- Anpassung bestehender Unit- und e2e-Tests, die alte Wortlaute prüfen.

## Prüfung

- Unit: Records vollständig, Längengrenze, Wächter, Options-Baustein rendert zwei Zeilen und
  geschlossen nur den Namen.
- Bestehende Tests auf neue Wortlaute umgestellt; `./scripts/check-all.sh --geaendert --ohne-e2e`.
- Bilder für den PR: Reiter Zugriff mit offener Rollenauswahl, Benutzerdialog mit beiden Feldern,
  Modul-Einstellungen mit offener Stufe — je vorher/nachher.
