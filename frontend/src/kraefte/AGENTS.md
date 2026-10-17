# Kräfte-Zeitachse und Ablösung — Regeln

Gilt für `kraefte/zeitachse.ts`, `kraefte/KraftZeitachse.tsx`, `src/zeitachse/`,
`src/routes/zeitachse.rs` und jede Stelle, die einen Statuswechsel, eine Disposition, die
Ablösung oder das Eintreffen am Bereitstellungsraum schreibt (sie schreiben die Zeitachse mit);
der Absatz „Ablösung“ gilt für `abloesung/`, `pages/AbloesungPage.tsx`,
`pages/einstellungen/EinsatzAbloesung.tsx`, `stammdaten/SchichtmodelleTab.tsx`,
`src/abloesung/` und `src/schichtmodell/`. Ergänzt `frontend/AGENTS.md`. Pfade relativ zu
`frontend/src/`, sofern nicht `src/…` (Server).

**Kräfte-Zeitachse** (LFH-552, `openspec/changes/archive/2026-09-30-lfh-552-kraefte-zeitachse/design.md`,
Spec `kraefte-zeitachse`): Alarmierung/Eintreffen/Ablösung/Entlassung je Einheit und Person in
`einsatz_kraft_zeitachse` (append-only, Streichung mit Grund statt Löschen; Guard
`repo_ist_append_only`); Zeitpunkte der Zeitachse stehen nie als Spalten an den
Dispositionstabellen. Der Lebenszustand einer Zeile (`beendet_*`, `aufgeloest_*`, LLH-1079) ist
keine Zeitachse: Dauer und Perioden rechnen nur aus der Zeitachse. Einziger Schreibpfad
`zeitachse::repo::schreibe_tx` (Perioden-Regeln rein in `zeitachse/perioden.rs`; ein Verstoß
bricht nie den Statuswechsel). Ereignisse entstehen aus `zeitachse_marke` am Status-Katalog
(Bestand ohne Marke, nie aus dem Label raten), aus Ablösung, Nachtrag, Entlassen und dem
Eintreffen am Bereitstellungsraum (Quelle `bereitstellungsraum`, LLH-1075: nur Einheiten, ein
schon eingetroffenes Eintreffen wird ausgelassen, ohne die Buchung zu brechen; bewusste Ausnahme
zu „neue Einheiten bekommen kein Ereignis“ aus `kraefte-disposition`: die unangemeldet erfasste
Einheit beginnt ihre Periode mit diesem Eintreffen). Das Kennzeichen `uebernahme_offen_seit`
ist kein Zeitpunkt der Zeitachse. Ein Einheit-Ereignis gilt per Fan-out für die
JETZT zugeordneten Personen; Fahrzeuge wirken nur über ihre Einheit (erstes Fahrzeug bzw. alle für
die Entlassung). Eine Ablösung, auch ihre Fan-out-Kopie und die an einer erbenden Untereinheit (LLH-1132), streicht nur die Rücknahme des Vollzugs.
`schreibe_tx` koppelt an einer Einheit auch die Schicht (LLH-1128, `src/abloesung/kopplung.rs`):
Eintreffen der offenen Periode beginnt sie (nur mit Vorgabe, nie bei geerbter), eine Entlassung
ohne offene Periode danach beendet sie (`beendet`), die Streichung dieser Entlassung öffnet sie;
in einem Savepoint, ein Fehler bricht nie den Anlass. Ihre ETB-IDs trägt `Beruehrt::abloesung`,
die Anlässe der Hinweise zur ablösenden Einheit `Beruehrt::hinweise` (LLH-1131,
`src/abloesung/hinweis.rs`); jeder Aufrufer meldet beides nach dem Commit über
`routes::abloesung::publish_kopplung`. Ein Weg, der ein Ereignis der ablösenden Einheit ohne
Zeitachse schreibt (Abruf, Eintreffen am Bereitstellungsraum, Auflösen), bildet seine Anlässe
in der Transaktion mit `hinweis::anlaesse_tx` und meldet sie ebenso.
Dauern rechnet der Client (`kraefte/zeitachse.ts`), ohne Ereignis keine Zahl, keine Grenzwerte
(LFH-860). Anzeige im Meldebild/Personal/Einheit-Detail, **nicht im Stab**. Bewusster Bruch von
LFH-46 E17 (Feldbefund) auf Entscheidung vom 30.09.2026 — gilt nur hierfür.

**Ablösung** (LFH-635, LLH-1122, Spec `kraefte-abloesung`): Der Rhythmus einer Schicht folgt
der Rangfolge eigener Wert → Vorgabe des Abschnitts → Vorgabe des Einsatzes
(`rhythmus_quelle` `einheit`/`abschnitt`/`einsatz`). Die Vorgabe des Einsatzes ist eine Kopie
eines Schichtmodells (`einsatz_schichtmodell`), nie ein Verweis auf die Stammdaten: Ändern oder
Löschen eines Modells berührt keinen laufenden Einsatz. Die Rangfolge rechnet der Server beim
Beginnen; der Client zeigt sie nur (Karte „(Vorgabe Einsatz)“, Platzhalter über
`components/vorgabeText.ts`) und erlaubt ein leeres Rhythmusfeld, sobald eine Stufe darüber
greift. Die Vorwarnzeit kommt je Schicht aus dem DTO (`vorwarnung_minuten`, aus dem
Schichtmodell des Einsatzes), nie aus einer Konstante im Client (`abloesung/einstufung.ts`,
`abloesung/useUhr.ts`). Dauern stehen nur über `abloesung/dauer.ts` („8 h“, „7:30 h“, nie
Dezimal), Wechselzeiten taktisch, Regeltexte über `abloesung/schichtmodellText.ts`. Die Vorgabe
der Organisation wechselt in den zwei Schritten, die der Server verlangt, nur über
`api/schichtmodelle.ts:setOrgVorgabe`. **Knoten-Modell** (LLH-1118 Punkt 1): eine Untereinheit
ohne eigene laufende Schicht erbt die ihres nächsten Vorfahren; der Server ermittelt das beim
Lesen (`abloesung::vererbung`, DTO `erbende_einheiten` an der tragenden Schicht), der Client
rechnet keine Vererbung nach. Status `beendet` (mit `beendet_grund`) ist kein `laufend`: jede
Prüfung auf eine laufende Schicht vergleicht streng `status === 'laufend'`. „Ohne Schicht“
(LLH-1128) bildet nur `abloesung/ohneSchicht.ts`: offene Periode wie `has_offene_periode_tx`,
Einheitenliste, minus eigene laufende Schicht und `erbende_einheiten`; nur mit Freigabe des
Moduls Einheiten (sonst gesperrt mit Grund), eigene Zuflussschleuse, kein „Schicht beginnen“ für
einen geplanten Ablöser. Kein Server-Anteil, solange Perioden und Erben im DTO stehen.
**Geplant** heißt Einzelplanung `abloesende_einheit_id` oder Ablöser-Liste
`einsatz_abloesung_abloeser`; jede Prüfung darauf liest beide (Planungshinweis, Hinweise,
Planungswarnungen, LLH-1131). Die Planungswarnungen ermittelt der Server beim Lesen
(`planung_warnungen`), der Client zeigt sie nur (`abloesung/planungWarnung.ts`), an der Karte in
der Rolle Achtung, nie als Einstufung. Der Planungshinweis ist eine Frist, keine Einstufung.
Den Stand eines geplanten Ablösers an der Karte („Ablösung: … · alarmiert … · eingetroffen …
(BR …)“, LLH-1131 Teil II) liest nur `abloesung/abloeserStand.ts` aus der offenen Periode der
Zeitachse; der Raum kommt aus `aktueller_br_id` und der Raumliste, die nur mit Freigabe der
Bereitstellungsräume und nur bei einem Ablöser im Raum abgefragt wird. Kein eigener Abruf, kein
DTO-Feld: live über die bestehenden Ereignisse. Jede Benachrichtigung der Ablösung springt zu
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
