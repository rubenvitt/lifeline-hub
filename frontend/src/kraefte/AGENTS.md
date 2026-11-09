# Kräfte-Zeitachse und Ablösung — Regeln

Gilt für `kraefte/zeitachse.ts`, `kraefte/KraftZeitachse.tsx`, `src/zeitachse/`,
`src/routes/zeitachse.rs` und jede Stelle, die einen Statuswechsel, eine Disposition, die
Ablösung oder das Eintreffen am Bereitstellungsraum schreibt (sie schreiben die Zeitachse mit);
der Absatz „Ablösung“ gilt für `abloesung/`, `pages/AbloesungPage.tsx`,
`pages/einstellungen/EinsatzAbloesung.tsx`, `pages/einstellungen/EinsatzGrenzwerte.tsx`,
`stammdaten/SchichtmodelleTab.tsx`,
`src/abloesung/` und `src/schichtmodell/`. Ergänzt `frontend/AGENTS.md`. Pfade relativ zu
`frontend/src/`, sofern nicht `src/…` (Server).

**Kräfte-Zeitachse** (LFH-552, `openspec/changes/archive/2026-09-30-lfh-552-kraefte-zeitachse/design.md`,
Spec `kraefte-zeitachse`): Alarmierung/Eintreffen/Ablösung/Entlassung je Einheit und Person in
`einsatz_kraft_zeitachse` (append-only, Streichung mit Grund statt Löschen; Guard
`repo_ist_append_only`); Zeitpunkte der Zeitachse stehen nie als Spalten an den
Dispositionstabellen. Der Lebenszustand einer Zeile (`beendet_*`, `aufgeloest_*`, LLH-1079) ist
keine Zeitachse: Dauer und Perioden rechnen nur aus der Zeitachse. Nachtrag und Streichung an
einer entlassenen Person sind der einzige Schreibweg an einer beendeten Kraft neben dem erneuten
Disponieren (LLH-1263, `src/routes/zeitachse.rs`): danach ist keine Periode offen (sonst 422),
das ETB vermerkt „berichtigt nach Entlassung“, die stornierte Person und die aufgelöste Einheit
bleiben bei 409; der Client sperrt das Streichen der abschließenden Entlassung
(`abschliessendeEntlassungId`). „Zeit berichtigen“ (LLH-1455, `zeitachse::repo::berichtige_tx`,
Routen `…/zeitachse/{zid}/berichtigen`) streicht ein Ereignis und schreibt es mit gleicher Art,
Quelle `nachtrag` und der alten Notiz zum neuen Zeitpunkt neu, in einer Transaktion; die
Perioden-Regeln gelten nur am Ergebnis (`perioden::ersetze`). Die Kopien folgen den bisherigen
Kopien, nie der heutigen Zuordnung; eine Person der Kette, deren Folge bräche oder die als
Entlassene eine offene Periode bekäme, macht alles zur 422 mit Namen. Die Kopplung an die
Ablösung läuft wie Streichung, dann Nachtrag; der Schichtbeginn wandert nicht mit. Ein
ETB-Eintrag „… berichtigt von … auf … — Grund: …“.
„Periode nachtragen“ (LLH-1538, `zeitachse::repo::trage_periode_nach_tx`, Routen
`…/zeitachse/periode`) schreibt Alarmierung und/oder Eintreffen und die Entlassung in einer
Transaktion (Quelle `nachtrag`, Notiz am Beginn); die Regeln gelten nur am Ergebnis, und die
Ereignisse müssen darin eine eigene Periode bilden (`perioden::fuege_periode_ein`, sonst 422).
Fan-out an die jetzt zugeordneten Personen ganz oder gar nicht, nie eine halbe Periode; Kopplung
erst am fertigen Stand: Alarmierung/Eintreffen der abgeschlossenen Periode wirken nicht, die
Entlassung beendet eine laufende Schicht nur, wenn danach keine Periode offen ist. Einziger INSERT bleibt `insert_tx`.
Einziger Schreibpfad
`zeitachse::repo::schreibe_tx` (Perioden-Regeln rein in `zeitachse/perioden.rs`; ein Verstoß
bricht nie den Statuswechsel). Ereignisse entstehen aus `zeitachse_marke` am Status-Katalog
(Bestand ohne Marke, nie aus dem Label raten), aus Ablösung, Nachtrag, Entlassen und dem
Eintreffen am Bereitstellungsraum (Quelle `bereitstellungsraum`, LLH-1075: nur Einheiten, ein
schon eingetroffenes Eintreffen wird ausgelassen, ohne die Buchung zu brechen; bewusste Ausnahme
zu „neue Einheiten bekommen kein Ereignis“ aus `kraefte-disposition`: die unangemeldet erfasste
Einheit beginnt ihre Periode mit diesem Eintreffen). Das Kennzeichen `uebernahme_offen_seit`
ist kein Zeitpunkt der Zeitachse. Ein Einheit-Ereignis gilt per Fan-out für die
JETZT zugeordneten Personen; Fahrzeuge wirken nur über ihre Einheit (erstes Fahrzeug bzw. alle für
die Entlassung). Eine Ablösung, auch ihre Fan-out-Kopie und die an einer erbenden Untereinheit
(LLH-1132), und jedes Ereignis der Quelle `abloesung` (Besatzungswechsel, LLH-1150) streicht nur
die Rücknahme des Vollzugs.
`schreibe_tx` koppelt an einer Einheit auch die Schicht (LLH-1128, `src/abloesung/kopplung.rs`):
Eintreffen der offenen Periode beginnt sie (nur mit Vorgabe, nie bei geerbter), eine Entlassung
ohne offene Periode danach beendet sie (`beendet`), die Streichung dieser Entlassung öffnet sie;
in einem Savepoint, ein Fehler bricht nie den Anlass. Ihre ETB-IDs trägt `Beruehrt::abloesung`,
die Anlässe der Hinweise zur ablösenden Einheit `Beruehrt::hinweise` (LLH-1131,
`src/abloesung/hinweis.rs`); jeder Aufrufer meldet beides nach dem Commit über
`routes::abloesung::publish_kopplung`. Ein Weg, der ein Ereignis der ablösenden Einheit ohne
Zeitachse schreibt (Abruf, Eintreffen am Bereitstellungsraum, Auflösen), bildet seine Anlässe
in der Transaktion mit `hinweis::anlaesse_tx` und meldet sie ebenso.
Dauern rechnet der Client (`kraefte/zeitachse.ts`), ohne Ereignis keine Zahl. Anzeige im
Meldebild/Personal/Einheit-Detail. Bewusster Bruch von LFH-46 E17 (Feldbefund)
auf Entscheidung vom 30.09.2026 — gilt nur hierfür.
**Einstufung** (LLH-730, `openspec/changes/archive/2026-11-08-u1piomi1-zeitachse-grenzwerte-einstufen/design.md`):
nur `zeitachse.ts:stufeEin` gegen die wirksamen `SchichtplanGrenzwerte` (Vorgaben 12 h/8 h
eingeschlossen, keine zweite Einstellung), mit derselben Trennregel wie der Plan-Befund `dienst`
(`src/abloesung/schichtplan/pruefung.rs`, `dienststrecken`; wer eine ändert, ändert beide). Gelesen
werden die Werte über `…/{einheiten,personal}/zeitachse/grenzwerte` (Key
`kraefteZeitachseGrenzwerte`), nie über den Schichtplan-GET (Modul Ablösung). Angezeigt nur über
`DauerMitEinstufung` in Meldebild „Im Einsatz“ und Personal „Einsatzdauer“, Rolle `achtung` mit
Wort; „Ruhe“, Einheit-Detail, Personenkopf, Überblick und Druck des Berichts bleiben neutral. Kein
Hinweis in der AlarmZentrale, kein Modulzähler, keine Benachrichtigung (Alarmbudget).

**Ablösung** (LFH-635, LLH-1122, Spec `kraefte-abloesung`): Der Rhythmus einer Schicht folgt
der Rangfolge eigener Wert → Vorgabe des Abschnitts → Vorgabe des Einsatzes
(`rhythmus_quelle` `einheit`/`abschnitt`/`einsatz`). Die Vorgabe des Einsatzes ist eine Kopie
eines Schichtmodells (`einsatz_schichtmodell`), nie ein Verweis auf die Stammdaten: Ändern oder
Löschen eines Modells berührt keinen laufenden Einsatz. Welches Modell ein neuer Einsatz kopiert
(Modell der Einsatz-Vorlage → Vorgabe der Organisation → keins, LLH-1313), entscheidet der Server
beim Anlegen (`schichtmodell::repo::copy_vorgabe_tx`); der Anlegedialog zeigt es nur
(„(Vorgabe Vorlage)“ über `vorlageVorgabe`) und sendet allein `vorlage_id`. Die Rangfolge der
Schicht rechnet der Server beim Beginnen; der Client zeigt sie nur (Karte „(Vorgabe Einsatz)“, Platzhalter über
`components/vorgabeText.ts`) und erlaubt ein leeres Rhythmusfeld, sobald eine Stufe darüber
greift. Die Vorwarnzeit kommt je Schicht aus dem DTO (`vorwarnung_minuten`, aus dem
Schichtmodell des Einsatzes), nie aus einer Konstante im Client (`abloesung/einstufung.ts`,
`abloesung/useUhr.ts`). Dauern stehen nur über `abloesung/dauer.ts` („8 h“, „7:30 h“, nie
Dezimal), Wechselzeiten im Feld taktisch, angezeigt in der Zeitdarstellung (`formatUhrzeiten`,
LLH-1437), Regeltexte über `abloesung/schichtmodellText.ts`. Die Vorgabe der Organisation
wechselt in den zwei Schritten, die der Server verlangt, nur über
`api/schichtmodelle.ts:setOrgVorgabe`. **Knoten-Modell** (LLH-1118 Punkt 1): eine Untereinheit
ohne eigene laufende Schicht erbt die ihres nächsten Vorfahren; der Server ermittelt das beim
Lesen (`abloesung::vererbung`, DTO `erbende_einheiten` an der tragenden Schicht), der Client
rechnet keine Vererbung nach. Status `beendet` (mit `beendet_grund`) ist kein `laufend`: jede
Prüfung auf eine laufende Schicht vergleicht streng `status === 'laufend'`. „Ohne Schicht“
(LLH-1128) bildet nur `abloesung/ohneSchicht.ts`: offene Periode wie `has_offene_periode_tx`,
Einheitenliste, minus eigene laufende Schicht und `erbende_einheiten`; nur mit Freigabe des
Moduls Einheiten (sonst gesperrt mit Grund), eigene Zuflussschleuse, kein „Schicht beginnen“ für
einen geplanten Ablöser, auch nicht für die Untereinheit eines geplanten Verbands (LLH-1311:
Vorfahrenkette über `ueber_einheit_id` wie `kopplung::is_geplanter_abloeser_tx`, keine
Vererbung). Kein Server-Anteil, solange Perioden und Erben im DTO stehen. Die Ansicht
der Seite steht in der Adresse (LLH-1312, `abloesungPfad(…, { ansicht })`, Zustand wie beim
Funkplan, „laufend“ ohne Parameter); ein Sprung von außen auf „Ohne Schicht“ nimmt diesen Pfad.
**Herkunft des Beginns** (LLH-1312, `einsatz_abloesung.beginn_quelle` `hand | eintreffen |
vollzug`): geschrieben nur in `abloesung::repo::create_schicht_tx` (Handweg, Autostart der
Kopplung, Folgeschicht des Vollzugs); eine übernommene Schicht behält ihren Wert, die Rücknahme
ändert ihn nie, nur ein geänderter Beginn (`aendern`) macht aus `eintreffen` ein `hand`. Der Client
leitet die Herkunft nicht aus Vorgänger oder Zeitachse ab; das Wort an der Karte bildet nur
`abloesung/beginnText.ts`.
**Geplant** heißt Einzelplanung `abloesende_einheit_id`, Ablöser-Liste
`einsatz_abloesung_abloeser` oder geplanter Besatzungswechsel `einsatz_abloesung_besatzung_plan`
(LLH-1319); der Planungshinweis liest alle drei (`has_planung_tx`, im Scheduler `planung_offen`),
Hinweise, Ausnahme vom Autostart und Planungswarnungen nur die beiden Einheiten-Quellen
(LLH-1131). Die Planungswarnungen ermittelt der Server beim Lesen
(`planung_warnungen`), der Client zeigt sie nur (`abloesung/planungWarnung.ts`), an der Karte in
der Rolle Achtung, nie als Einstufung. Der Planungshinweis ist eine Frist, keine Einstufung.
Den Stand eines geplanten Ablösers an der Karte („Ablösung: … · alarmiert … · eingetroffen …
(BR …)“, LLH-1131 Teil II) liest nur `abloesung/abloeserStand.ts` aus der offenen Periode der
Zeitachse; der Raum kommt aus `aktueller_br_id` und der Raumliste, die nur mit Freigabe der
Bereitstellungsräume und nur bei einem Ablöser im Raum abgefragt wird, „· abgerufen …“ aus deren
`abrufe` (LLH-1309: das Abruf-Ereignis der BR-Belegung, kein Zeitachsen-Ereignis, keine Spalte an
der Einheit; nach dem Ausrücken fällt es weg). Kein eigener Abruf: live über die bestehenden
Ereignisse. Bei einem geplanten Verband zählt sein Teilbaum (LLH-1509, je Art der früheste
Zeitpunkt); welche Untereinheiten dazugehören, liefert der Server am Ablöser (`untereinheiten`),
der Client geht die Gliederung dafür nicht selbst ab. Den Vermerk „Planung entfallen“ (LLH-1309, mit der
auslösenden Entlassung ab LLH-1510) schreibt nur `drop_planungen_tx`, räumt `set_abloeser_tx` und die Streichung
der Entlassung (`restore_entfallene_planungen_tx`: holt die Planung zurück, nur solange der
Vermerk noch Grund `entlassung` und genau diese Entlassung trägt; eine Berichtigung hebt „wiederhergestellt“
und „entfallen“ gegeneinander auf); ob er gilt (laufend, kein Ablöser), entscheidet
der Server (`planung_entfallen`), der Client zeigt ihn nur (`abloesung/planungWarnung.ts`). Jede Benachrichtigung der Ablösung springt zu
ihrer Schicht (`abloesungPfad(…, { schicht })`, Server `benachrichtigung::text::pfad`, beide
gleich); die Seite nimmt `?schicht=` nach `useQueryParamSelektion` an.

**Vollzug** (LLH-1132, Spec `kraefte-abloesung`): Die Liste der Ablöser ist die Wahrheit
(höchstens `ABLOESER_MAX`, Spiegel `ABLOESUNG_ABLOESER_MAX`); `abloesende_einheit_id` ist ihr
erster Eintrag: wer die Liste ändert, zieht ihn über `abloesung::repo::set_abloeser_tx` bzw.
`sync_spiegel_tx` nach (auch `drop_planungen_tx`), nie von Hand. Welcher Ablöser den Knoten bildet (kein Vorfahr in der Liste) und wer
erbt, entscheidet der Server; der Client zeigt die Liste über `abloesung/abloeser.ts` und rechnet
nichts nach. Wählbar ist jede andere Einheit ohne laufende Folgeschicht (`abloeserOptionen`);
eine eigene laufende Schicht ohne Vorgänger übernimmt der Vollzug, die Rücknahme löst sie nur
(`uebernommen_bei_vollzug`). Die Ausnahme vom Autostart gilt für jeden geplanten Ablöser und die
Untereinheiten eines geplanten Verbands. „Abschnitt übergeben“ ändert `einsatz_einheit.abschnitt_id`
nur am Knoten und an der abgelösten Einheit, mit Vorher-Werten an Schicht und Liste, und
verlangt die Freigabe des Moduls Einheiten; die Rücknahme legt nur zurück, was noch den Stand des
Vollzugs trägt.

**Verbleib nach dem Vollzug** (LLH-1308, Spec `kraefte-abloesung`): `einsatz_abloesung.verbleib`
(`ruhe` | `bereitstellungsraum` | `entlassen`, nur bei Art `einheit`) wählt das Ende-Ereignis der
Zeitachse (`zeitachse::repo::vollzug_ende_tx`: `abloesung`, bei `entlassen` stattdessen
`entlassung`); die Schicht steht vorher schon auf `abgeloest`, daher endet sie über die Kopplung
LLH-1128 nicht zusätzlich. Jede Belegungsbuchung des Vollzugs (Eintritt der abgelösten Einheit,
Abruf/Austritt eines Ablösers im Raum) steht in `einsatz_abloesung_br_buchung`; nur daraus bucht
die Rücknahme das Gegenstück, und nur solange die Buchung das jüngste Ereignis ihrer Kraft ist.
Der Raum verlangt die Freigabe des Moduls Bereitstellungsräume, der Abruf des Ablösers nicht.
Optionen, Body und Kartentext des Felds „Danach“ bildet nur `abloesung/verbleib.ts`.

**Besatzungswechsel** (LLH-1150, Entscheidung LLH-1118 Punkt 4, Spec `kraefte-abloesung`): Das
LFH-635-Non-Goal „keine Personal-Ebene“ ist **nur hierfür** aufgehoben. Art `einheit | besatzung`
an der Schicht (`einsatz_abloesung.art`, eine laufende trägt `einheit`); Einheit, Fahrzeug und
Abschnitt bleiben, die Folgeschicht hängt an derselben Einheit. Wer ging und wer kam, steht nur in
`einsatz_abloesung_besatzung` (Rolle `alt`/`neu` samt Vorher-Werten für die Rücknahme), geschrieben
nur von `abloesung::repo::vollziehen_besatzung_tx`. Die alte Besatzung ist die Zuordnung
`einsatz_personal.einheit_id` der Einheit und ihrer erbenden Untereinheiten beim Vollzug (dieselbe
Menge wie der Fan-out der ganzen Einheit); sie verliert Einheit, Fahrzeug dieser Einheiten und
Führung. Die Zeitachse bekommt nur Personen-Ereignisse (alt `abloesung`, neu `eintreffen`, Quelle
`abloesung`), keine an der Einheit; **keine Grenzwerte, keine Ruhezeit je Person** (eingestuft wird
nur in der Kräfte-Zeitachse, Absatz „Einstufung“ oben, LLH-730). Der Wechsel verlangt die Freigabe des Moduls Einheiten (Server) und im Dialog
dazu die des Moduls Personal (Auswahl); die bisherige Besatzung und die wählbaren Personen bildet
nur `abloesung/besatzung.ts`. Die Rücknahme legt nur zurück, was noch den Stand des Vollzugs
trägt. **Verteilung und Planung** (LLH-1319): je neuer Person optional Ziel-Einheit (die Einheit
oder ein Erbe, sonst 422) und Fahrzeug (aktiv, einer dieser Einheiten; 404/409/422), geprüft in
`check_neue_besatzung_tx` (eine Abfrage); der Vollzug merkt das Ziel in `einheit_nachher_id`/
`fahrzeug_nachher_id`, die Rücknahme legt nur zurück, wer noch dort steht bzw. sitzt. Eine Schicht
plant entweder Ablöser oder einen Besatzungswechsel (`besatzung_plan`, beides → 422, einziger
Schreibweg `set_besatzung_plan_tx`); der Dialog sendet deshalb beide Listen. Der Vollzug sichert
die Ablöser-Liste (`einsatz_abloesung_planung_vorher`, `planung_gesichert`), die Rücknahme stellt
sie wieder her; der geplante Wechsel bleibt beim Vollzug stehen. Ziele, Vorbelegung und Texte
(„Besatzungswechsel geplant · neu: …“, „nach Besatzungswechsel · Besatzung: …“) bildet nur
`abloesung/besatzung.ts`.

**Schichtplan** (LLH-1552, Spec `kraefte-schichtplan`): Blöcke an Einheit, UHS oder Pause sind
Soll; sie ändern keine Zuordnung, und wer nur im Plan steht, ist nicht im Einsatz. Die Fälligkeit
einer laufenden Schicht kommt aus den Blöcken ihrer Einheit, wenn der Server es so rechnet
(LLH-1555, `faellig_laut_plan`, `plan_folgeblock`); der Client zeigt nur die Zeile „Laut Plan · …“
(`abloesung/lautPlan.ts`) und bietet dann kein „Rhythmus ändern“. Die Vorlage des Wechsels
(`ladePlanVorlage`, Key `abloesungPlanVorlage`) rechnet der Server; der Vollzug-Dialog schickt sie
als Art „Laut Plan“ ab und rechnet Bleibende, Übernahme und Folgeblock nie selbst nach.
Überschneidung (422), Soll-Kopie vom Posten, Lücke, offene Anforderungen und alle Befunde
(`doppelt`, `quali`, `dienst`, `verfuegbar`, `abweichung`) rechnet der Server beim Lesen
(`abloesung::schichtplan::pruefung`); der Client zeigt sie nur und rechnet nichts nach. Jeder
Schreibweg eines Blocks antwortet mit dem ganzen Plan (`api/schichtplan.ts`), Key
`schichtplan` unter `abloesungen`, live über `abloesung`. Ohne Freigabe von Personal kommen
`personen` und `helfer` als `null`.
**Grenzwerte bedienen** (LLH-1603, `openspec/changes/archive/2026-11-09-z11srqhq-grenzwerte-bedienstelle/design.md`): Höchstdienst und
Mindestruhe setzt nur das Paneel „Dienst und Ruhe“ in Einstellungen › Ablösung
(`pages/einstellungen/EinsatzGrenzwerte.tsx`). Die Ansicht „Schichtplan“ nennt sie nur in einer Zeile
mit Sprung dorthin, ohne zweiten Schreibweg. Das Paneel liest den Plan unter dem Key `schichtplan`.
Die PATCH-Antwort ersetzt ihn, und `kraefteZeitachseGrenzwerte` wird für Einheiten und Personal
neu geholt. Den Text und die Bodies bildet nur `abloesung/grenzwerte.ts`. „(Vorgabe)“ folgt nur den
Merkern `*_eigen`, nie dem Wert. Ein Body trägt nur geänderte Felder (fehlt = unverändert, `null` =
Vorgabe). Die Vorgaben 12 h/8 h stehen dort als Spiegel des Servers, die Grenzen in
`api/eingabegrenzen.ts`.

**Schichtplan einlesen** (LLH-1556, `abloesung/schichtplan/SchichtplanEinlesen.tsx`): Datei und
Wahl gehen bei Vorschau UND Übernehmen als Multipart an den Server, der jedes Mal neu liest und
abgleicht; der Client hält keinen Inhalt der Datei und rechnet keinen Abgleich nach. Jede Wahl
fragt die Vorschau neu ab. Der Plan aus der Antwort des Übernehmens ersetzt den Cache. Der
gemeinsame Kern mit der Vorplanung (LLH-1561) ist `abloesung::schichtplan::uebernahme`
(`PlanPaket` → `bestand_tx` → `planen` → `schreiben_tx`); „In Einsatz übernehmen“ einer Planung
(LLH-1587, `planung/PlanungUebernahmeDialog.tsx`, Server `planung::uebernahme`) baut nur das
Paket und zeigt die Vorschau über dieselbe `ImportVorschauAnsicht`
(`abloesung/schichtplan/ImportVorschauAnsicht.tsx`). Eine dritte Quelle bringt ebenfalls nur ihr
Paket und keinen eigenen Abgleich oder eine eigene Vorschau mit. Der ETB-Eintrag nennt die Quelle
über `anlass` von `schreiben_tx`.
