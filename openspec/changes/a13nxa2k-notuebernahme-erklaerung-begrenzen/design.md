# Design

## Context

Motivation: `proposal.md`, „Why“. Was der Code heute tut (gelesen am 12.11.2026, Stand
`origin/alpha` 3d74eba3):

- **Eingabe:** `src/routes/benutzer.rs` prüft den Anzeigenamen beim Anlegen und beim PATCH nur
  mit `pflicht`. Der Bearbeiten-Dialog schickt den Namen immer mit.
- **Von außen:** `auth::oidc::provisioning::plane_anzeigename` übernimmt den Claim ungekürzt.
  `instanz::stammdaten::uebernehmen` schreibt die Spalte `anzeigename` der Art Konto aus dem
  gelieferten JSON; für Konten wird `uebersetzt` dort schon vor dem Upsert angepasst
  (`system_rolle`). `instanz::spiegel::abbildung::stellvertreter` kürzt bereits auf 200 Zeichen
  (`chars().take(200)`).
- **Erklärung:** `instanz::fuehrung::dienst` baut sie an zwei Stellen
  (`notuebernahme_gegen_erreichte`, `build_erklaerung_gegen_meldende`) und schreibt ihren Text an
  zwei Stellen in die Akte (`notuebernahme_gegen_erreichte`, `notuebernahme_gegen_meldende`).
  `notuebernahme_mit_code` ändert nach dem Bauen noch `epoche_neu`. Der Text ist
  `serde_json::to_string`; das Gegenüber prüft `erklaerung.len() <= ERKLAERUNG_MAX` in Byte
  (`austausch::AkteMeldung::is_in_grenzen_bis`).
- **Warum die Grenze am Namen nicht reicht:** `serde_json` schreibt Steuerzeichen als `\u00XX`,
  sechs Byte je Zeichen. Ein Grund aus 500 und ein Name aus 200 solchen Zeichen ergeben über
  4200 Byte. Dazu kommen Bestandskonten mit beliebig langem Namen. Mit gewöhnlichem Text bleibt
  die Erklärung nach dem Kürzen unter der Grenze: selbst Grund und Name nur aus Emoji (vier Byte
  je Zeichen) brauchen zusammen 2800 Byte, der Rest der Erklärung einige Hundert.

## Goals / Non-Goals

**Goals:**

- Keine Notübernahme wird lokal wirksam, deren Erklärung das Gegenüber wegen der Größe ablehnt.
- Der Anzeigename folgt der Regel „Eingabegrenzen“ wie jedes andere Freitextfeld, an jedem
  Eingang.
- Ein Konto mit altem, überlangem Namen kann im Notfall weiter übernehmen.

**Non-Goals:**

- Keine Migration, die Bestandsnamen kürzt.
- Keine Grenze für Namen von Gerätekonten („Stelle · Gerät“) und für das Bootstrap-Konto: beide
  setzt der Server aus schon begrenzten oder festen Teilen.
- Steuerzeichen werden weder aus dem Grund noch aus dem Namen gefiltert.
- Andere Felder der Akte (`fuehrer_name`, Kennungen) und der volle Name in `wer` des lokalen
  Verlaufs bleiben, wie sie sind.

## Decisions

### D1 Grenze: `auth::ANZEIGENAME_MAX = 200`

Die Konstante steht in `src/auth/mod.rs`, weil `auth` das Konto (`Benutzer`) besitzt
(`src/AGENTS.md`, „Eingabegrenzen“: Konstante im Modul, das das Feld besitzt). 200 ist der Wert,
auf den der Stellvertreter schon gekürzt wird, und die Grenze des Einheitennamens. Gespiegelt in
`frontend/src/api/eingabegrenzen.ts`, verglichen in `tests/eingabegrenzen_spiegel.rs`.

Verworfen: 100 Zeichen (trifft Namen der Form „Name · Funktion · Ortsverein“ eher, und der
Stellvertreter wäre dann anders begrenzt als das Original).

### D2 Eingabe: 400 über `pflicht_max`, auch wenn der Name unverändert mitkommt

Anlegen und PATCH rufen `routes::support::pflicht_max(…, "Anzeigename", ANZEIGENAME_MAX)`. Der
Statuscode ist 400 nach `src/AGENTS.md` („Statuscode-Konvention“: das Feld für sich). Das Ticket
nennt 422; der Mensch hat am 12.11.2026 für die Regel entschieden.

Der PATCH prüft den Namen, sobald er im Request steht, auch unverändert. Ein Konto mit
Bestandsnamen über der Grenze lässt sich deshalb erst speichern, wenn der Name gekürzt ist. Die
Maske zeigt das vorher (Spec `eingabegrenzen`, „Vorbelegter Text über der Grenze“).

Verworfen: nur prüfen, wenn sich der Name ändert. Das hielte überlange Namen dauerhaft am Leben
und bräuchte einen Vergleich mit dem Bestand, den kein anderes begrenztes Feld macht.

### D3 Von außen: eine Funktion kürzt, drei Eingänge rufen sie

`auth::truncate_anzeigename(&str) -> String` nimmt die ersten `ANZEIGENAME_MAX` Zeichen
(Unicode-Skalarwerte, wie jede Grenze im Backend). Aufrufer:

- `plane_anzeigename` (SSO-Erstanmeldung),
- `stammdaten::uebernehmen` für die Art Konto, an der Stelle, die `uebersetzt` schon anpasst,
  ohne Hinweis,
- `spiegel::abbildung::stellvertreter` statt der Zahl 200.

Verworfen: ablehnen (das Konto fehlte dann, die Anmeldung scheiterte); kürzen mit Hinweis an der
Kopplung (der Mensch hat „still“ gewählt, wie beim Stellvertreter).

### D4 Erklärung: Unterzeichner kürzen, dann den fertigen Text prüfen

- **Kürzen beim Bauen:** Beide Stellen, die eine `NotuebernahmeErklaerung` bauen, setzen
  `unterzeichner` auf `truncate_anzeigename(wer)`. Damit ist auch der Text, den ein Admin
  unterschreibt, schon der gekürzte.
- **Prüfen am fertigen Text:** `dienst::erklaerung_text(&e) -> Result<String, AppError>` liefert
  `e.to_text()` oder 422, wenn der Text mehr als `austausch::ERKLAERUNG_MAX` Byte hat. Dasselbe
  Maß und dieselbe Konstante wie beim Empfänger; `ERKLAERUNG_MAX` wird dafür im Modul
  `fuehrung` sichtbar (`pub(super)`).
- **Jeder Text kommt aus dieser Funktion:** in `notuebernahme_gegen_erreichte` und
  `notuebernahme_gegen_meldende` vor dem Speichern (in der Transaktion: ein Fehler bricht sie ab,
  nichts wird wirksam), am Ende von `build_erklaerung_gegen_meldende`, damit die Unterschrift gar
  nicht erst beginnt, in `routes::fuehrung::run_start` für den Text unter der Unterschrift und in
  `notuebernahme_mit_code` für den Text unter dem Prüfwert (nach dem Tausch von `epoche_neu`).
  Außerhalb von `erklaerung_text` ruft kein Produktivcode mehr `to_text()` einer Erklärung
  (nach dem Review vor dem PR so gefasst: vorher nahmen Unterschrift und Prüfwert den Text
  direkt, geprüft war er nur davor und danach).
- **Text des 422:** „Die Erklärung der Notübernahme ist zu groß für die Übertragung. Bitte den
  Grund kürzen.“ Nach dem Kürzen des Unterzeichners ist der Grund das Einzige, was die Person
  ändern kann. Der Dialog im Paneel „Führung“ zeigt Serverfehler schon an; die Umsetzung prüft
  das mit einem Test.

Verworfen:

- **Nur ablehnen:** Ein Konto mit altem Namen könnte im Notfall nicht übernehmen, bis ein Admin
  den Namen ändert.
- **Aufs Restbudget kürzen:** ginge fast immer durch, aber der Name in der Erklärung wäre
  beliebig verstümmelt, und die Regel ließe sich niemandem in einem Satz sagen.
- **Prüfen im Empfängerformat (`AkteMeldung::is_in_grenzen_bis`) statt am Text:** prüfte Felder
  mit, die die Notübernahme nicht setzt, und meldete Fehler, die mit dem Grund nichts zu tun
  haben.

### D5 Die Entscheidung steht als ADR

`docs/architektur/AGENTS.md`, „Mitänderungsregel“: eine Entscheidung der Route `entwurf` (E1)
bekommt eine ADR. Titel sinngemäß „Eine Erklärung, die das Gegenüber ablehnen würde, lehnt der
Sender ab, bevor sie lokal gilt“, `gilt_fuer: src/instanz/fuehrung/**`, Nummer die nächste freie
auf `alpha` zum Zeitpunkt der Umsetzung (ADR-0031: 0029 trägt der offene PR #1318, 0030 liegt
auf `alpha`), dazu `src/routes/fuehrung.rs`. Regeln: Jeder Text einer Erklärung kommt aus
`erklaerung_text`; gekürzt wird nur der Unterzeichner, auf `ANZEIGENAME_MAX`. Prüfung per
`verlange`/`verbiete` auf `dienst.rs` und `routes/fuehrung.rs` (kein `e.to_text()` mehr).

### D6 Maske: Zähler und Regel, kein natives `maxLength`

Beide Felder „Anzeigename“ in `BenutzerPage.tsx` bekommen `count={zeichenGrenze(ANZEIGENAME_MAX)}`
und `zeichenRegel(ANZEIGENAME_MAX, 'Anzeigename')` (`frontend/AGENTS.md`, „Freitext nie länger
als der Server erlaubt“; Muster `personen/LeichterFallModal.tsx`). Natives `maxLength` scheidet
aus: Im Bearbeiten-Dialog kann ein Bestandsname über der Grenze vorbelegt sein, und der muss
stehen bleiben und das Speichern sperren.

## Risks / Trade-offs

- [Zwei Konten, deren Namen sich erst nach dem 200. Zeichen unterscheiden, sehen in der Erklärung
  gleich aus] → Der lokale Verlauf führt in `wer` weiter den vollen Namen; ab dieser Change
  entstehen solche Namen nicht mehr.
- [Ein Konto mit Bestandsnamen über 200 Zeichen lässt sich erst nach dem Kürzen bearbeiten] →
  Die Maske zeigt Zähler und „zu lang“. Reaktivieren schickt nur `aktiv`, Deaktivieren und
  Einmalpasswort laufen über eigene Aufrufe ohne den Namen (`BenutzerPage.tsx`) und gehen
  weiter.
- [Die Kürzung schneidet nach Skalarwerten, nicht nach Graphemen: ein zusammengesetztes Emoji am
  200. Zeichen kann zerteilt werden] → dasselbe Maß wie jede Grenze im Backend; hingenommen.
- [Ein älteres Gegenüber schickt weiter überlange Namen oder Erklärungen] → Namen kürzt die
  Übernahme (D3); eine zu große Erklärung lehnt der Empfänger wie bisher ab (LLH-1672).
- [Der 422 ist mit ehrlichen Eingaben nicht erreichbar und rostet] → Tests knapp unter und knapp
  über der Grenze auf allen drei Wegen, dazu eine Mutationsprobe (Prüfung entfernen, Tests rot).

## Migration Plan

Keine Migration, keine Wire-Änderung. Zurückrollen heißt den Commit zurücknehmen; Namen, die in
der Zwischenzeit gekürzt übernommen wurden, bleiben gekürzt.
