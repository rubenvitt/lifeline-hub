# Prüfliste Einsatztauglichkeit: Funktionskatalog (LFH-549)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen oder umgebauten Fläche. Planung und Specs liegen
daneben (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Umgebaut | Empfängerfeld im Auftragsformular (`auftraege/AuftragFormular.tsx`, vier Einbettungen), Empfängerfeld im Erinnerungsformular (`erinnerung/ErinnerungFormular.tsx`), Führungsstellen-Dialog (`pages/MitgliederAbschnitt.tsx`), ETB-Felder „Von“/„An“ (Vorschläge, `etb/Schnellerfassung.tsx`), Auftrags- und Erinnerungskarten (Anzeige der Besetzung), Stabseite (Label) |
| Neu | Verwaltung → Stammdaten → Führungsfunktionen (`/admin/stammdaten/fuehrungsfunktionen`, `stammdaten/FuehrungsfunktionenTab.tsx`) |
| Zielkontext | Fükw (primär: Erfassen, Lesen), ortsfeste Stelle (Erfassen). Führungs-Tablet und mobil: Lesen der Karten, Auswahl per Tipp. Die Verwaltung ist ein Schreibtischvorgang |
| Nicht enthalten | Postkorb „Aufträge an meine Funktion“ (eigene Frage, kein Anlass) · Codes an `etb_eintrag.von`/`an` (Funkverkehr, bewusst Freitext) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/fuehrungsfunktionen.rs` (19) | Katalog, Labels, S7, Statuscodes; Paar-Test Besetzungswechsel (Snapshot bleibt, Auflösung folgt); ohne Stab-Recht keine Auflösung; nach der Schwärzung kein Name; Führungsstelle als Katalogwert samt Vorbelegung |
| Mutationsproben Backend | (1) CHECK-Liste ohne `fachberater` → `check_listen_entsprechen_dem_katalog` rot. (2) Wire-Wert umbenannt → `enum_wire_kontrakt` rot. (3) Rechteprüfung der Auflösung abgeschaltet → `ohne_stab_recht_keine_aufloesung` rot |
| Vitest | `fuehrung/funktionsOptionenKern.test.ts` (Optionen, Umkehr, kein Rückschluss „S3“, Vorrangregel, Anzeige), `AuftragFormular.test.tsx`, `ErinnerungFormular.test.tsx`, `MitgliederAbschnitt.test.tsx`, `ErinnerungKarte.test.tsx`, `ueberblickDaten.test.ts`, `StabPage.test.tsx`, `sachgebiete.test.ts`, `FuehrungsfunktionenTab.test.tsx`, `adminNav.test.tsx` |
| `e2e/fuehrungsfunktionen.spec.ts` | Auftrag per Katalogwahl „S3 – Einsatz (Müller)“; Karte zeigt „S3 Einsatz · Müller“, nach Umbesetzen live „· Schulz“. Führungspersonal ohne Stab-Freigabe sieht nur „S3 Einsatz“ |
| `e2e/fuehrungsstelle.spec.ts` | Angepasst: der Dialog trägt jetzt eine Auswahl; Enter übernimmt den Freitext, gesendet wird über den Knopf im `<form>` |
| `e2e/gate3-trefflaeche.spec.ts` | Neu: „Führungsfunktionen: der Bearbeiten-Knopf je Zeile hält 30 / 48 / 72 px“ |
| Grep über die neuen Quellen (ohne Tests) | `size=` 0 · Farbliterale 0 · `animation`/`blink` 0 · Emoji 0 |

---

## Tabelle 1: Empfängerfelder (Auftrag, Erinnerung, Führungsstelle, ETB-Vorschläge)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** [abgeleitet] | Das Feld ist antds `Select` über `components/Select`, Höhe aus `controlHeight` der Dichtestufe; die Optionen stehen im Portal-Menü mit derselben Zeilenhöhe wie die übrigen Auswahllisten | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Unverändert: die Erfassungshülle zeigt `laeuft` am Knopf, Fehler bleiben an der Maske (`mutateAsync`) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Anlegen eines Auftrags bzw. Setzen einer Stelle ist umkehrbar; nichts wird gelöscht | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Keine neue Farbe; Optionen und Karten nutzen Theme- und Rollenfarben (`rollen.gedaempft` für Nebentext) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Die Besetzung steht als Wort („· Schulz“, „· nicht vergeben“, „· bei der Einsatzleitung“), ohne eigene Farbe | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbbelegung | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Keine kritische Anzeige; die Besetzung ist eine Zusatzangabe am Empfänger | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine neue Meldung | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Ein Besetzungswechsel ändert nur den Text hinter dem Snapshot in derselben Zeile; keine neue Zeile, kein Einschieben. Die Auftragsliste behält ihr Sammelbanner-Verhalten | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine neue schwebende Leiste; das Auswahlmenü liegt im Portal über dem Feld | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Labels über dem Feld; „Werte behalten“ übernimmt den Empfänger in Auftrag und Erinnerung (`UEBERNAHME`); volle Tastaturbedienung: Tippen, Pfeiltasten, Enter wählt, Verlassen übernimmt den Freitext; gesendet wird über den Knopf im `<form>` (Strukturtest „Knopf im form, kein Modal-Fuß“ in `ErinnerungFormular.test.tsx`, `MitgliederAbschnitt.test.tsx`) | — |

**Bilanz:** 10 erfüllt · 0 offen · 5 nicht anwendbar.

## Tabelle 2: Verwaltung → Führungsfunktionen

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Bearbeiten-Knopf der Inline-Angabe hält 30/48/72 px (Gate 3, neuer Test); der S7-Schalter über `switchMasse` | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size`; Gate 3 misst die Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | `InlineAngabe` zeigt `loading` am Speichern; der Schalter ist während des Sendens gesperrt; Fehler an der Seite (`SeitenHinweise`) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Ein Label ist jederzeit zurücksetzbar (leer = Standard), S7 wieder ausschaltbar | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Nur Theme-Farben und `Typography type="secondary"` | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Schalter mit Wort („an“/„aus“), ausgeschaltetes S7 mit „— ausgeschaltet“ | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | App-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Verwaltung, keine Lage | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Feste Liste aus dem Katalog; S7 steht auch ausgeschaltet an seinem Platz, das Einschalten verschiebt keine Zeile | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte Leiste; Fokusrückgabe im Primitiv (`useFokusRueckgabe`) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Liste, weil nichts verglichen wird (LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Inline-Angabe mit Standardlabel als Platzhalter, Enter speichert, Escape verwirft, Rechtehinweis ohne Adminrecht (`STAMMDATEN_RECHTE_TEXT`) | — |

**Bilanz:** 10 erfüllt · 0 offen · 5 nicht anwendbar.
