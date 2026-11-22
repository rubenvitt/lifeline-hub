# Android-Hülle Implementation Plan (LLH-1989)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/y1dsr5i98hhgl5s3tvlwedmz

**Goal:** Eine Android-App (Kotlin, Compose, Android-WebView), die sich wie die iOS-Hülle verhält, als signierte APK an jedem freigegebenen Tag ausgeliefert wird und sich selbst aktualisiert.

**Architecture:** Wie iOS: ein reiner Kotlin/JVM-Kern `android/kern` (eigener Gradle-Build, testbar ohne Android-SDK) trägt jede Entscheidung als Zustandsfunktion; die App `android/app` führt nur Wirkungen aus (WebView je Profil, Brücke, Systemdienste, Updater). CI: Kern im Gate (`check-all.sh`), App per Robolectric in `android-pruefung.yml`, Auslieferung per `android.yml` aus `artefakte.yml`.

**Tech Stack:** Gradle-Wrapper 9.9.2, Android Gradle Plugin 9.5.x, Kotlin 2.4.x, kotlinx.serialization, JUnit 5 (Kern), Jetpack Compose (BOM 2026.11.01), `androidx.webkit` 1.18.0, `androidx.browser` 1.10.0, WorkManager, ML Kit Barcode (gebündeltes Modell) mit CameraX, Robolectric 4.18.x und Roborazzi (App-Tests und Bilder), Vitest (Init-Skript).

**Spec:** `docs/superpowers/specs/2026-11-22-y1dsr5i9-android-huelle-design.md` (im Folgenden „Entwurf“, Abschnitte D1–D11). Vorbild je Datei: `ios/LifelineKern/Sources/LifelineKern/<gleichnamig>.swift` und `ios/App/…`; Verhalten und Texte von dort übernehmen, wo der Entwurf nichts anderes sagt.

## Global Constraints

- Keine Anwendungslogik in der Hülle; jede Entscheidung mit Test im Kern, die App führt nur aus (Entwurf D1, `ios/AGENTS.md`).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Namen wie im iOS-Kern, Kotlin-Schreibweise (`ServerAdresse.parse`, `Vertragspruefung.evaluate`).
- Paketname `dev.rubeen.lifeline.android`; Kern-Paket `dev.rubeen.lifeline.kern`.
- `minSdk` 29; `compileSdk`/`targetSdk` 36 (37 nur, wenn Robolectric es kann).
- Ein WebView-Profil je Server (Name = UUID des Eintrags); nie gemeinsames Profil, auch nicht als Rückfall (Entwurf D3).
- Brücke und Start-Skript nur für die Origin des aktiven Servers, Nachrichten nur aus dem Hauptframe (Entwurf D4).
- Kennung `platform: 'android'`, kein `setAppBadge` (Entwurf D4).
- Vertrauen: System- und Nutzer-CAs, keine Ausnahmen, kein Pinning; `onReceivedSslError` bricht immer ab (Entwurf D2a).
- `versionName` = volle Workspace-Version; `versionCode` = Minuten seit 2026-01-01T00:00Z (Entwurf D4).
- Kanal beim ersten Start aus der Version (`-alpha.` → `alpha`, `-beta.` → `beta`, ohne Suffix → `stabil`, sonst kein Kanal = keine Updates), gespeichert, nie durch ein Update geändert (Entwurf D4).
- Updater: Prüfung höchstens alle 4 Stunden; Download nur von `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`; `sha256` prüfen; installiert nie bei Oberfläche im Vordergrund; Hintergrund nach 15 Minuten nur ohne Rückfrage des Systems (Entwurf D9).
- Release-Dateien: `lifeline-hub-android-<version>.apk` (+ `.sha256`), fester Name `lifeline-hub-android.apk`, Manifest `android.json` `{ version, version_code, url, sha256 }`; Kanal-Releases `android-alpha`, `android-beta`; feste APK im Kanal nur vom eigenen Kanal ersetzt (Entwurf D9).
- Geheimnisse: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Gemeinsame Fälle nur in `src-tauri/faelle/*.json`, nie nur in einem Kotlin-Test; der Kern liest sie aus dem Repo (wie `GemeinsameFaelle.swift`).
- Kein Server-Code wird geändert.
- Prosa (Kommentare, Commits, UI-Texte, Testnamen als Satz in Backticks) deutsch.

## Review Focus

1. **Serverwechsel, während eine Antwort der Brücke unterwegs ist** — die Antwort darf nie die Seite des neuen Servers erreichen; erwartet: sie verfällt (Test in Task 6, `Bruecke`).
2. **Update ist bereit, während die Oberfläche im Vordergrund läuft** — erwartet: nur Hinweis, kein Installieren, auch nicht nach langer Zeit im Vordergrund (Test in Task 8, `Installzeitpunkt`).
3. **Kaltstart ohne Netz für einen Server, der in diesem Profil nie geladen wurde** — erwartet: „nicht erreichbar“, kein leerer WebView (Test in Task 5, `Ablauf`).
4. **Entfernen eines Servers, dessen Profil sich nicht löschen lässt** — erwartet: Eintrag bleibt, Meldung, zweiter Versuch geht (Test in Task 3, `Serverentfernung`).
5. **QR-Code mit fremdem Inhalt (WLAN-Code, `http://`, Deeplink mit `@`-Host)** — erwartet: nichts wird vorbelegt (Test in Task 2, `Deeplink.adresseAusQrCode`).

---

### Task 1: Gradle-Gerüst, Kern-Build und Adressprüfung im Gate

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`, `android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.{jar,properties}`, `android/.gitignore`
- Create: `android/kern/settings.gradle.kts`, `android/kern/build.gradle.kts`
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/LifelineKern.kt`, `.../Adresse.kt`
- Test: `android/kern/src/test/kotlin/dev/rubeen/lifeline/kern/GemeinsameFaelle.kt`, `.../AdresseTest.kt`
- Modify: `scripts/check-all.sh` (neuer `schritt_20`, Bündel `android`), `scripts/bereiche.sh` (+ `bereiche.test.sh`)

**Interfaces:**
- Produces: `object LifelineKern { val bekannteVertraege: List<Int> = listOf(1) }`
- Produces: `enum class AdressError(val kennwort: String) { LEER("leer"), UNLESBAR("unlesbar"), KEIN_HTTPS("kein_https"), OHNE_HOST("ohne_host"), MIT_ZUGANGSDATEN("mit_zugangsdaten"); val meldung: String }`
- Produces: `@Serializable(with = …) data class ServerAdresse(val text: String, val host: String) { val port: Int? ; companion object { fun parse(eingabe: String): ServerAdresse /* wirft AdressException(error: AdressError) */ } }`
- Produces: `object GemeinsameFaelle { fun <T> load(name: String, serializer: KSerializer<T>): T }` (Test-Hilfe; Pfad `src-tauri/faelle` relativ zur Repo-Wurzel, gefunden über das Arbeitsverzeichnis des Testlaufs)

- [ ] **Step 1: Gerüst anlegen.** `android/kern` ist ein eigenständiger Gradle-Build (Kotlin/JVM, JVM-Ziel 17, kotlinx.serialization, JUnit 5) mit eigenem `settings.gradle.kts`; `android/settings.gradle.kts` bindet ihn per `includeBuild("kern")` ein (die App kommt in Task 10). Wrapper auf Gradle 9.9.2. `android/kern` konfiguriert sich ohne Android-SDK: `android/gradlew -p android/kern test` läuft mit nur JDK.

- [ ] **Step 2: Failing tests schreiben** — `AdresseTest`:
  - `` `jeder gemeinsame Fall der Adressprüfung gilt` `` liest `adresse.json`, prüft je Fall `ServerAdresse.parse(eingabe).text == adresse` bzw. `AdressException.error.kennwort == fehler`, und `meldungen[kennwort] == AdressError.meldung` für alle fünf.
  - `` `Standardport fällt weg, Host wird klein` ``: `parse("https://ELW.local:443/a?b#c").text == "https://elw.local/a?b#c"`.
  - `` `Adresse überlebt JSON` ``: Serialisieren und Lesen ergibt dieselbe Adresse; ein ungültiger Text beim Lesen wirft.

- [ ] **Step 3: Lauf rot** — `android/gradlew -p android/kern test` → FAIL (Klassen fehlen).

- [ ] **Step 4: `ServerAdresse.parse` umsetzen** nach `Adresse.swift` Regel für Regel (Trimmen, `leer`, Schema lesen, drei Schrägstriche, `ohne_host` für Schemata mit Host, `kein_https`, Zugangsdaten). Eigene kleine Zerlegung über `java.net.URI` mit Rückfall auf Handzerlegung, wo `URI` strenger ist; Wahrheit sind die gemeinsamen Fälle.

- [ ] **Step 5: Lauf grün** — `android/gradlew -p android/kern test` → PASS.

- [ ] **Step 6: Gate.** `schritt_20` in `check-all.sh` nach dem Muster von `schritt_18`: „Kotlin-Kern der Android-Hülle gegen die gemeinsamen Fälle (LLH-1989)“; ohne `java` (oder Version < 17) Lücke, mit `ANDROID_KERN_PFLICHT=1` rot; sonst `"$ROOT/android/gradlew" -p "$ROOT/android/kern" test --console=plain`. `BUENDEL_android="20"`, in `alle`, `--nur android`, Hilfe-Kopf. `bereiche.sh`: neue Ausgabe `android=true|false`; `android/*` → `android`; `src-tauri/faelle/*` zusätzlich `android`; `android/app/src/main/assets/huelle.js` → `frontend android`. Fälle in `bereiche.test.sh` dafür.

- [ ] **Step 7: Prüfen** — `./scripts/check-all.sh --nur android` → OK; `scripts/bereiche.test.sh` → OK.

- [ ] **Step 8: Commit** `feat(android): Kotlin-Kern mit Adressprüfung im Gate (LLH-1989)`

### Task 2: Deeplink, QR-Code, Linkregeln, Linkweiche, Downloadablage

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/{Deeplink,Linkregeln,Linkweiche}.kt`
- Test: `android/kern/src/test/kotlin/dev/rubeen/lifeline/kern/{DeeplinkTest,LinkregelnTest,LinkweicheTest}.kt`

**Interfaces:**
- Consumes: `ServerAdresse` (Task 1)
- Produces: `object Deeplink { const val SCHEMA = "lifeline"; fun parse(link: String): ServerAdresse?; fun decide(gespeichert: ServerAdresse?, neu: ServerAdresse): Aktion; fun decide(aktiv: ServerAdresse?, bekannt: List<ServerAdresse>, neu: ServerAdresse): Aktion; fun adresseAusQrCode(inhalt: String): ServerAdresse? ; sealed interface Aktion { data class Vorbelegen(val adresse: ServerAdresse); data class Bestaetigen(val adresse: ServerAdresse); data object Nichts; val kennwort: String } }`
- Produces: `object Linkregeln { enum class Ziel(val kennwort: String) { HUELLE, NEBENFENSTER, DOWNLOAD, SYSTEM, VERWERFEN }; fun neuesFenster(server: URI?, ziel: URI): Ziel; fun navigation(server: URI?, ziel: URI): Ziel; fun belongsToServer(server: URI, seite: URI): Boolean; internal fun isEigeneOrigin(server: URI?, ziel: URI): Boolean }`
- Produces: `object Linkweiche { sealed interface Entscheidung { data object Erlauben; data object Abbrechen; data object Download; data class ImWebviewLaden(val url: URI); data class System(val url: URI) }; fun navigation(server: URI?, ziel: URI, isMainFrame: Boolean, neuesFenster: Boolean, seite: URI?): Entscheidung }` und `object Downloadablage { fun dateiname(vorschlag: String): String }`

- [ ] **Step 1: Failing tests** — `` `jeder gemeinsame Fall des Deeplinks gilt` `` (`deute`, `entscheide` aus `deeplink.json`); `` `ein unbekannter Server wird vorbelegt statt gewechselt` `` (zweite `decide`); `` `jeder gemeinsame Fall der Linkregeln gilt` `` (`neues_fenster`, `navigation`, `gehoert_zum_server` aus `links.json`); Linkweiche-Fälle wie `LinkweicheTests.swift` ohne `shouldPerformDownload`/`antwort` (Android meldet Downloads über den `DownloadListener`, Task 13); Review Focus 5: `` `fremder QR-Inhalt belegt nichts vor` `` mit `"WIFI:S:ELW;T:WPA;P:x;;"`, `"http://elw.local"`, `"lifeline://verbinden?server=https://elw.local:8443@evil.example"` → jeweils `null`; `Downloadablage.dateiname` mit `"../a/b:c.csv"` → `"b_c.csv"`, `"..."` → `"Download"`.
- [ ] **Step 2: Lauf rot** — `android/gradlew -p android/kern test` → FAIL.
- [ ] **Step 3: Umsetzen** nach `Deeplink.swift`, `Linkregeln.swift`, `Linkweiche.swift`, `Huellenhilfen.swift` (`adresseAusQrCode`).
- [ ] **Step 4: Lauf grün** → PASS.
- [ ] **Step 5: Commit** `feat(android): Deeplink und Linkregeln im Kern (LLH-1989)`

### Task 3: Serverliste, Ablage, Entfernen

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/{Serverliste,Serverablage,Serverentfernung}.kt`
- Test: `.../{ServerlisteTest,ServerablageTest,ServerentfernungTest}.kt`

**Interfaces:**
- Consumes: `ServerAdresse`
- Produces: `@Serializable data class ServerEintrag(val id: String /* UUID */, val name: String, val adresse: ServerAdresse, val zuletztVerbunden: Long? /* epoch ms */, val bestaetigterVertrag: Int?, val geladenImProfil: Boolean = false)`
- Produces: `@Serializable data class Serverliste(val eintraege: List<ServerEintrag> = emptyList(), val aktivId: String? = null) { val aktiv: ServerEintrag?; fun eintragFuer(adresse: ServerAdresse): ServerEintrag?; fun add(adresse: ServerAdresse, name: String? = null, neueId: () -> String): Pair<Serverliste, ServerEintrag>; fun rename(id: String, name: String): Serverliste; fun activate(id: String): Serverliste; fun remove(id: String): Serverliste; fun markVerbunden(id: String, zeit: Long, vertrag: Int): Serverliste; fun markGeladen(id: String): Serverliste }` — wirft `ListException(error: ListError)` mit `enum class ListError { UNBEKANNT, AKTIV_NICHT_ENTFERNBAR }`
- Produces: `class Serverablage(val verzeichnis: File) { fun load(): Serverliste; fun save(liste: Serverliste); fun loadOrRecover(): Serverliste }` (`server.json`, defekt → `server.defekt.json`)
- Produces: `interface Entfernungsdienste { val serverliste: Serverliste; fun closeWebView(profil: String); suspend fun removeProfil(profil: String); fun removeEintrag(id: String) }`, `object Serverentfernung { val HINWEIS: String; fun rueckfrageTitel(e: ServerEintrag): String; fun isEntfernbar(id: String, liste: Serverliste): Boolean; suspend fun run(id: String, dienste: Entfernungsdienste) /* wirft EntfernungException(Fehler) */ ; sealed interface Fehler { Unbekannt; Aktiv; data class Profil(val name: String, val grund: String); val meldung: String } }`

- [ ] **Step 1: Failing tests** nach `ServerlisteTests.swift`, `ServerentfernungTests.swift` und den Ablage-Fällen aus `HuellenhilfenTests.swift`, dazu: `` `markGeladen merkt sich, dass das Profil diesen Server schon zeigte` ``; Review Focus 4: `` `scheitert das Löschen des Profils, bleibt der Eintrag und ein zweiter Versuch geht` `` (Attrappe wirft beim ersten `removeProfil`, beim zweiten nicht; Reihenfolge der Aufrufe `closeWebView` → `removeProfil` → `removeEintrag`). Texte (`HINWEIS`, Meldungen) wortgleich wie Swift, „Datenspeicher“ → „Daten“ bleibt.
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen** (immutable Werte statt `mutating`; Coroutines nur `kotlinx-coroutines-core` im Kern).
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Serverliste und Entfernen im Kern (LLH-1989)`

### Task 4: Vertrag, Fehlerklassen, Status-Seiten und Texte

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/{Vertrag,Statustext}.kt`
- Test: `.../{VertragTest,StatustextTest}.kt`

**Interfaces:**
- Produces: `@Serializable data class ShellInfo(val version: String, @SerialName("shell_contract") val shellContract: Int)`; `fun healthVersion(json: String): String?`
- Produces: `enum class Netzfehler { ZERTIFIKAT, VERBINDUNG, ABGEBROCHEN }` (die App ordnet Ausnahmen und WebView-Fehlercodes zu, Task 12)
- Produces: `enum class Fehlerklasse { ZERTIFIKAT, NICHT_ERREICHBAR, ZU_ALT, ZU_NEU }`
- Produces: `sealed interface ShellAbruf { data class Antwort(val status: Int, val body: String, val contentType: String?); data class Fehler(val netzfehler: Netzfehler) }`
- Produces: `sealed interface Vertragsergebnis { data class Vertraeglich(val info: ShellInfo); data class NichtVertraeglich(val klasse: Fehlerklasse, val server: ShellInfo?); data class NichtErreichbar(val klasse: Fehlerklasse); val fehlerklasse: Fehlerklasse? }`
- Produces: `object Vertragspruefung { fun evaluate(abruf: ShellAbruf, letzterVertrag: Int?, bekannt: List<Int> = LifelineKern.bekannteVertraege): Vertragsergebnis; fun followsRedirect(von: URI?, nach: URI?): Boolean; fun richtung(vertrag: Int, bekannt: List<Int>): Fehlerklasse? }`
- Produces: `sealed interface Statusseite { data object Zertifikat; data object NichtErreichbar; data class NichtVertraeglich(val klasse: Fehlerklasse, val serverVersion: String?); data object WebviewVeraltet; companion object { fun from(ergebnis: Vertragsergebnis, healthVersion: String?): Statusseite? } }`
- Produces: `data class Statustext(val titel: String, val text: String, val schritte: List<String>)`; `fun Statusseite.text(servername: String?, appVersion: String?): Statustext`

- [ ] **Step 1: Failing tests** nach `VertragTests.swift` und `StatustextTests.swift`, mit diesen Android-Abweichungen:
  - `` `Zertifikat nennt den Android-Weg` ``: `schritte` = `["CA-Zertifikat auf das Gerät laden.", "Unter Einstellungen → Sicherheit → Weitere Sicherheitseinstellungen → Zertifikat installieren → CA-Zertifikat das Zertifikat auswählen (der Menüpfad heißt je nach Hersteller etwas anders).", "Zurück in die App wechseln oder „Erneut prüfen“ tippen."]`; `text` wie iOS mit „CA-Zertifikat“ statt „CA-Profil“.
  - `` `App aktualisieren verweist auf das Update der App` ``: Text endet mit „Bitte die App aktualisieren.“ (statt TestFlight).
  - `` `veralteter System-WebView hat eine eigene Seite` ``: `WebviewVeraltet.text(...)` → Titel „System-WebView aktualisieren“, Text „Diese App braucht einen aktuellen System-WebView, damit jeder Server seine eigenen Daten hat. Bitte „Android System WebView“ über Google Play aktualisieren.“
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen.** `Netzfehler.ABGEBROCHEN` ist kein Fehler der Seite (wie `cancelled`).
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Vertragsprüfung und Status-Seiten im Kern (LLH-1989)`

### Task 5: Ablauf mit Start ohne Server, Onboarding, Rückkehr, Testzustand

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/{Ablauf,Onboarding,Rueckkehr,Testzustand}.kt`
- Test: `.../{AblaufTest,OnboardingTest,RueckkehrTest}.kt`

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: `object Ablauf { val WIEDERHOL_INTERVALL_MS = 5_000L; sealed interface Seite { Onboarding; data class Pruefung(val eintrag: ServerEintrag); data class Web(val eintrag: ServerEintrag, val vertrag: Int, val offline: Boolean = false); data class Status(val eintrag: ServerEintrag, val status: Statusseite); data object WebviewVeraltet }; sealed interface Event { data class Start(val aktiv: ServerEintrag?, val webviewTauglich: Boolean); data class Wechseln(val eintrag: ServerEintrag); data class Verbunden(val eintrag: ServerEintrag, val info: ShellInfo); data class Vordergrund(val seiteAntwortet: Boolean, val adresse: URI?, val anmeldungLaeuft: Boolean); data object ZurOberflaeche; data class SeiteGeladen(val url: URI?); data class Ergebnis(val ergebnis: Vertragsergebnis, val healthVersion: String?, val fuer: String); data object Wiederholen; data class NavigationFehlgeschlagen(val fehler: Netzfehler, val url: URI?); data object WebProzessBeendet }; sealed interface Effect { data class Check(val eintrag: ServerEintrag); data class Load(val eintrag: ServerEintrag); data object Reload; data class MarkVerbunden(val id: String, val vertrag: Int); data class MarkGeladen(val id: String); data object ScheduleRetry; data object ShowZurOberflaeche; data object HideZurOberflaeche }; data class Step(val seite: Seite, val effects: List<Effect> = emptyList()); fun next(seite: Seite, event: Event): Step; fun bietetZurOberflaeche(seite: Seite): Boolean }`
- Produces: `object Onboarding { … }` wie `Onboarding.swift` (State/Event/Effect/Step, `next`)
- Produces: `class Rueckkehr { enum class Phase { ACTIVE, INACTIVE, BACKGROUND }; fun melde(phase: Phase): Boolean }`
- Produces: `enum class Testzustand(val wert: String) { ONBOARDING("onboarding"), SERVERLISTE("serverliste"), EINSTELLUNGEN("einstellungen"), ZERTIFIKAT("zertifikat"), NICHT_ERREICHBAR("nicht-erreichbar"), ZU_ALT("zu-alt"), ZU_NEU("zu-neu"), WEBVIEW_VERALTET("webview-veraltet"), UPDATE_BEREIT("update-bereit"), UPDATE_LAEUFT("update-laeuft"), WEB("web"), FREMDE_SEITE("fremde-seite"); companion object { const val EXTRA = "lifeline.testzustand"; fun from(wert: String?): Testzustand? } }` und `Testzustand.BEISPIELSEITE` (HTML aus `Huellenstil.swift`)

- [ ] **Step 1: Failing tests** — alle Fälle aus `AblaufTests.swift` und `OnboardingTests.swift` übertragen; dazu die Android-Fälle (Entwurf D3, D5):
  - `` `ohne taugliches WebView zeigt der Start nur die Seite WebView veraltet` ``: `next(Onboarding, Start(aktiv=e, webviewTauglich=false)).seite == WebviewVeraltet`, keine Effekte; ebenso ohne Server.
  - `` `ohne Netz lädt ein schon geladener Server offline` ``: aus `Pruefung(e mit geladenImProfil=true, bestaetigterVertrag=1)` und `Ergebnis(NichtErreichbar(NICHT_ERREICHBAR))` → `Web(e, 1, offline=true)` mit `[Load(e), ScheduleRetry]`.
  - Review Focus 3: `` `ohne Netz zeigt ein nie geladener Server nicht erreichbar` ``: wie oben mit `geladenImProfil=false` → `Status(e, NichtErreichbar)` mit `[ScheduleRetry]`.
  - `` `Zertifikatsfehler lädt nie offline` ``: `NichtErreichbar(ZERTIFIKAT)` mit `geladenImProfil=true` → `Status(e, Zertifikat)`.
  - `` `offline geladen und Hauptnavigation scheitert zeigt nicht erreichbar` ``: `Web(e,1,offline=true)` + `NavigationFehlgeschlagen(VERBINDUNG, url=e.adresse)` → `Status(e, NichtErreichbar)` mit `[ScheduleRetry]`.
  - `` `offline geladen prüft weiter und lädt bei Rückkehr des Servers nicht neu` ``: `Web(offline=true)` + `Wiederholen` → `[Check(e)]`; danach `Ergebnis(Vertraeglich(1))` → `Web(e,1,offline=false)` mit `[MarkVerbunden]` ohne `Load`; `Ergebnis(NichtErreichbar)` → bleibt `Web(offline=true)` mit `[ScheduleRetry]`.
  - `` `nach dem ersten geladenen Commit merkt sich die App das Profil` ``: `Web(e,1)` + `SeiteGeladen(url auf e)` mit `e.geladenImProfil=false` → Effekt `MarkGeladen(e.id)`.
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen** nach `Ablauf.swift` mit den Ergänzungen oben.
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Ablauf mit Start ohne Server im Kern (LLH-1989)`

### Task 6: Brücke, Befehle, Ausführung, Haptik, Init-Skript, Stil, Dialoge

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/{Bruecke,Brueckenbefehl,Brueckenausfuehrung,Haptik,Initskript,Huellenstil,Seitendialog}.kt`
- Test: `.../{BrueckeTest,BrueckenbefehlTest,HaptikTest,InitskriptTest,HuellenstilTest,SeitendialogTest}.kt`

**Interfaces:**
- Produces: `data class SeitenOrigin(val schema: String, val host: String, val port: Int /* -1 = Standard */) { companion object { fun parse(origin: String): SeitenOrigin? } }` (WebView meldet die Origin als Text `https://host[:port]`)
- Produces: `object Bruecke { const val OBJEKT_NAME = "lifeline"; fun accepts(isMainFrame: Boolean, origin: SeitenOrigin?, aktiverServer: ServerAdresse?): Boolean; fun allowedOriginRule(server: ServerAdresse): String; fun parse(nachricht: String): Brueckenbefehl?; fun replyJson(antwort: Brueckenantwort): String }`
- Produces: `sealed interface Brueckenbefehl { data class Haptics(val kind: String); data class ShowNotification(val id: Int, val title: String, val body: String?); data class Print(val id: Int); data class SignInWithBrowser(val id: Int); data class DownloadBlob(val id: Int, val name: String, val base64: String); data class Ungueltig(val id: Int, val grund: String) }` — `download_blob` `{ name, data }` mit `data` über 50 MB (Base64-Länge > 70 000 000) → `Ungueltig`; `Huellendienste` bekommt dafür `suspend fun saveDownload(name: String, bytes: ByteArray)` — `set_app_badge` ist auf Android `Ungueltig(id, "Unbekannter Befehl der Hülle: set_app_badge")`
- Produces: `data class Brueckenantwort(val id: Int, val fehler: String?, val wert: Antwortwert)`; `sealed interface Antwortwert { data object Null; data class Bool(val wert: Boolean) }`
- Produces: `enum class Meldungsfreigabe { OFFEN, ERLAUBT, VERWEIGERT }`; `interface Huellendienste { val isHaptikEnabled: Boolean; fun play(feedback: Haptik.Feedback); suspend fun loadMeldungsfreigabe(): Meldungsfreigabe; suspend fun requestMeldungsfreigabe(): Boolean; suspend fun showNotification(title: String, body: String?); suspend fun print(): Boolean; fun startAnmeldung() }`; `object Brueckenausfuehrung { const val MELDUNGEN_AUS = "Meldungen sind für Lifeline ausgeschaltet (Einstellungen → Apps → Lifeline → Benachrichtigungen)."; suspend fun run(befehl: Brueckenbefehl, dienste: Huellendienste): Brueckenantwort? }`
- Produces: `object Haptik { enum class Feedback { CONFIRM, REJECT, WARNING, SELECTION, TAP }; fun feedback(kind: String, isEnabled: Boolean): Feedback?; const val SCHALTER_SCHLUESSEL = "haptik"; fun isEnabled(gespeichert: Boolean?): Boolean }` (Zuordnung zu `HapticFeedbackConstants` macht die App, Task 13)
- Produces: `object Initskript { const val PLATZHALTER = "__LIFELINE_VERSION__"; fun render(vorlage: String, version: String?): String }`, `object Huellenstil { const val KENNUNG; val CSS; val skript: String }`, `data class Seitendialog(…)` wie Swift

- [ ] **Step 1: Failing tests** nach `BrueckeTests.swift`, `BrueckenbefehlTests.swift`, `HaptikTests.swift`, `InitskriptTests.swift`, `HuellenstilTests.swift`, `SeitendialogTests.swift`; Nachrichten kommen als JSON-Text (`{"cmd":"print","id":3}`), Zahlen als JSON-Zahlen, `"3"` als Text ist keine `id`. Dazu:
  - `` `allowedOriginRule nennt Schema, Host und Port ohne Standardport` ``: `https://elw.local:8443/` → `"https://elw.local:8443"`, `https://elw.local/` → `"https://elw.local"`.
  - Review Focus 1: `` `nach einem Wechsel nimmt die Brücke die alte Origin nicht mehr an` ``: `accepts(true, origin(A), aktiverServer=B) == false`; und `` `ohne Origin nimmt die Brücke nichts an` `` (`origin = null`).
  - `` `set_app_badge gibt es auf Android nicht` `` → `Ungueltig`.
  - `` `Haptik bildet tap auf TAP und unbekanntes auf nichts ab` ``.
  - `` `ein zu großer blob-Download wird abgelehnt` `` und `` `download_blob ohne Namen heißt Download` ``.
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen** nach den Swift-Vorbildern; `replyJson` liefert `{"id":…,"fehler":…|null,"wert":…}` für den Reply-Proxy (Task 9 liest genau das).
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Brücke, Haptik und Init-Skript im Kern (LLH-1989)`

### Task 7: Anmeldung im Browser

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Anmeldung.kt`
- Test: `.../AnmeldungTest.kt`

**Interfaces:**
- Produces: `object PKCE { fun neuerVerifier(): String; fun challenge(verifier: String): String }` (`SecureRandom`, `MessageDigest("SHA-256")`, base64url ohne Auffüllung)
- Produces: `object Anmeldung { const val ANMELDESEITE = "/login"; const val BESTAETIGUNG = "/app-anmeldung"; const val EREIGNIS = "lifeline:app-anmeldung"; const val RUECKSPRUNG_HOST = "anmeldung"; enum class Ergebnis { ANGEMELDET, ABGELEHNT, FEHLER, ABGEBROCHEN }; sealed interface Ende { data class Ruecksprung(val url: String); data object Abgebrochen; data object Fehler }; sealed interface Folge { data class Einloesen(val code: String); data class Melden(val ergebnis: Ergebnis); data object Nichts }; fun bestaetigungUrl(server: ServerAdresse, challenge: String): URI; fun code(ausRuecksprung: String): String?; fun folge(ende: Ende, seite: URI?, server: ServerAdresse): Folge; fun einloeseSkript(server: ServerAdresse, code: String, verifier: String): String; fun meldungSkript(ergebnis: Ergebnis): String }`
- Produces: `class Anmeldelauf<W> { val isLaufend: Boolean; fun naechste(): Long; fun merke(generation: Long, wert: W); fun nimm(): W?; fun beende(generation: Long): W? }`

- [ ] **Step 1: Failing tests** nach `AnmeldungTests.swift` (RFC-7636-Vektor: `challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFxWFlXT0") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"`; NIST-Vektoren entfallen, `MessageDigest` ist erprobt), dazu `` `ein Rücksprung ohne laufende Anmeldung bleibt wirkungslos` ``: `Anmeldelauf` leer → `nimm() == null`, die App wertet dann nichts aus (Entwurf D7).
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Anmeldung im Browser im Kern (LLH-1989)`

### Task 8: Kanal und Updater-Entscheidungen

**Files:**
- Create: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/{Kanal,Update}.kt`
- Test: `.../{KanalTest,UpdateTest}.kt`

**Interfaces:**
- Produces: `enum class Kanal(val kennwort: String) { ALPHA("alpha"), BETA("beta"), STABIL("stabil"); val manifestUrl: String; companion object { const val REPO = "https://github.com/rubenvitt/lifeline-hub"; fun fromVersion(version: String): Kanal?; fun fromKennwort(text: String?): Kanal? } }` — `manifestUrl`: `ALPHA` → `$REPO/releases/download/android-alpha/android.json`, `BETA` → `…/android-beta/android.json`, `STABIL` → `$REPO/releases/latest/download/android.json`
- Produces: `@Serializable data class Updatemanifest(val version: String, @SerialName("version_code") val versionCode: Int, val url: String, val sha256: String) { companion object { fun parse(json: String): Updatemanifest? } }`
- Produces: `object Semver { fun compare(a: String, b: String): Int? }` (SemVer 2.0 Vorrang; `null` bei ungültig)
- Produces: `object Updateentscheidung { const val PRUEF_ABSTAND_MS = 4 * 60 * 60 * 1000L; const val HINTERGRUND_MS = 15 * 60 * 1000L; val ERLAUBTE_HOSTS = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"); fun isFaellig(letztePruefung: Long?, jetzt: Long): Boolean; fun isNeuer(eigeneVersion: String, eigenerCode: Int, manifest: Updatemanifest): Boolean; fun isErlaubterDownload(url: String): Boolean; fun isSha256(text: String): Boolean }`
- Produces: `object Installzeitpunkt { enum class Lage { START_VOR_OBERFLAECHE, VORDERGRUND, HINTERGRUND }; enum class Weg { INSTALLIEREN, HINWEIS, WARTEN }; fun decide(lage: Lage, imHintergrundSeit: Long?, jetzt: Long, brauchtRueckfrage: Boolean): Weg }`
- Produces: `enum class Updatestand { KEINS, LAEDT, BEREIT, INSTALLIERT_GLEICH, BLOCKIERT, ERLAUBNIS_FEHLT, FEHLER }` (für Einstellungen und Hinweis)

- [ ] **Step 1: Failing tests**
  - `` `Kanal folgt dem Vorab-Suffix` ``: `"1.0.0-alpha.196"` → `ALPHA`, `"1.0.0-beta.3"` → `BETA`, `"1.0.0"` → `STABIL`, `"1.0.0-rc.1"`, `"0.0.0-dev"`, `""` → `null`.
  - `` `Manifest-Adressen je Kanal` `` mit den drei URLs oben.
  - `` `nur ein neueres Release mit größerem Code ist ein Update` ``: eigene `1.0.0-alpha.5`/100 gegen `1.0.0-alpha.6`/101 → `true`; gegen `1.0.0-alpha.6`/100 → `false`; gegen `1.0.0`/200 → `true`; gegen `1.0.0-alpha.4`/300 → `false`.
  - `` `Download nur von GitHub` ``: `https://github.com/rubenvitt/lifeline-hub/releases/download/v1/x.apk` → `true`; `http://github.com/…` → `false`; `https://github.com.evil.example/…` → `false`.
  - `` `Prüfung höchstens alle vier Stunden` ``.
  - Review Focus 2: `` `im Vordergrund installiert der Updater nie` ``: `decide(VORDERGRUND, null, jetzt, false) == HINWEIS`, auch mit `brauchtRueckfrage = true`.
  - `` `beim Start vor der Oberfläche wird installiert` `` (`START_VOR_OBERFLAECHE`, beide Werte von `brauchtRueckfrage`) → `INSTALLIEREN`.
  - `` `im Hintergrund erst nach 15 Minuten und nur ohne Rückfrage` ``: 14 min → `WARTEN`; 15 min, `brauchtRueckfrage=false` → `INSTALLIEREN`; 15 min, `true` → `HINWEIS`.
  - `Semver.compare` mit Vorrangfällen aus semver.org (`1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0`).
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Kanal und Updater-Entscheidungen im Kern (LLH-1989)`

### Task 9: Init-Skript der Android-Hülle und Frontend

**Files:**
- Create: `android/app/src/main/assets/huelle.js`
- Modify: `frontend/src/test/huelle.ts` (`starteAndroidHuelle`, `antworteAndroidHuelle`, `beendeHuelle` räumt `lifeline` weg)
- Create: `frontend/src/huelle/androidHuelle.test.ts`
- Modify: `frontend/src/huelle/faehigkeiten.ts` (Kommentare: `'android'`), `frontend/src/rueckmeldung/adresse.ts` (`'android'` → „Android-App“) + bestehender Test dort

**Interfaces:**
- Consumes: Wire-Format aus `ios/App/Huelle/huelle.js` (Befehle, `id`, Antwort `{ id, fehler, wert }`), `Initskript.PLATZHALTER`
- Produces: Skript erwartet `window.lifeline` mit `postMessage(text: string)` und `onmessage`/`addEventListener('message', …)` (Objekt von `addWebMessageListener`); sendet `JSON.stringify({ cmd, id, … })`; Antworten kommen als `event.data` = JSON-Text aus `Bruecke.replyJson`. Kennung: `platform: 'android'`, `version`, `passkey: false`, `anmeldungImBrowser`, `haptics`, `benachrichtigungZeigen`; ersetzt `window.print`; fängt Klicks auf `<a download href="blob:…">` der eigenen Seite ab, liest den Blob und sendet `download_blob` `{ name, data }` (Base64); ohne `window.lifeline` tut es nichts.

- [ ] **Step 1: Failing tests** in `androidHuelle.test.ts` nach `iosHuelle.test.ts`: Kennung vollständig und ohne `setAppBadge`; `haptics('unknown')` sendet nichts und wirft nie; `benachrichtigungZeigen` erfüllt/lehnt ab nach Antwort; `print` sendet `print`; ohne Brücke keine Kennung; Platzhalter bleibt → `version` fehlt; `` `blob-Download geht als download_blob an die Hülle` `` (Klick auf einen `<a download="liste.csv" href="blob:…">` sendet `{ cmd: 'download_blob', name: 'liste.csv', data }` und verhindert die Standardaktion). `adresse.test.ts`: `platform 'android'` → `oberflaeche=Android-App`.
- [ ] **Step 2: Lauf rot** — `mise exec -- pnpm -C frontend exec vitest run src/huelle/androidHuelle.test.ts src/rueckmeldung` → FAIL.
- [ ] **Step 3: Skript und Frontend umsetzen.**
- [ ] **Step 4: Lauf grün** — dieselben Tests → PASS; `mise exec -- pnpm -C frontend typecheck` und Lint → OK.
- [ ] **Step 5: Commit** `feat(android): Init-Skript der Android-Hülle mit Vitest (LLH-1989)`

### Task 10: App-Gerüst, Version, Marke, Testzustand und Bildlauf

**Files:**
- Create: `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/network_security_config.xml`, `android/app/src/main/res/values/{strings,themes,colors}.xml`, `android/app/src/main/kotlin/dev/rubeen/lifeline/android/{LifelineApp,MainActivity,AppModell}.kt`, `.../ui/Thema.kt`
- Create: `scripts/android/version.sh` (+ `version.test.sh`), `scripts/android/erzeuge-symbol.sh`, Symbol-Ressourcen (`mipmap-anydpi-v26/ic_launcher.xml`, Vordergrund/Hintergrund)
- Modify: `android/settings.gradle.kts` (`include(":app")`), `scripts/marke/erzeuge-symbole.sh`, `frontend/src/marke/marke.guard.test.ts`, `scripts/check-all.sh` (`version.test.sh` in Schritt 8)
- Test: `android/app/src/test/kotlin/dev/rubeen/lifeline/android/BilderTest.kt` (Roborazzi)

**Interfaces:**
- Consumes: Kern (Tasks 1–8)
- Produces: `scripts/android/version.sh [--cargo <Cargo.toml>] [--jetzt <epoch-sekunden>]` gibt zwei Zeilen `LIFELINE_VERSION=<workspace-version>` und `LIFELINE_VERSION_CODE=<minuten seit 2026-01-01T00:00Z>` aus; Gradle liest beide aus der Umgebung, ohne sie `0.0.0-dev` und `1`.
- Produces: `class AppModell(…)` hält `Ablauf.Seite`, `Onboarding.State`, `Serverliste`, `Updatestand` als Compose-State und führt Effekte aus; `MainActivity` liest `Testzustand.from(intent.getStringExtra(Testzustand.EXTRA))` und zeigt dann die Seite mit Beispieldaten ohne Netz und ohne Speichern.

- [ ] **Step 1: Failing tests** — `version.test.sh`: `--jetzt 1767225600` (2026-01-01T00:00Z) → `LIFELINE_VERSION_CODE=0`; `--jetzt 1767225660` → `1`; Version aus einer Test-Cargo.toml. `BilderTest`: `` `Onboarding als Bild` `` rendert `Testzustand.ONBOARDING` per Robolectric und vergleicht/schreibt mit Roborazzi nach `android/app/build/bilder/onboarding.png`.
- [ ] **Step 2: Lauf rot** — `scripts/android/version.test.sh`; `android/gradlew -p android :app:testDebugUnitTest` → FAIL.
- [ ] **Step 3: Umsetzen.** Manifest: `INTERNET`, `CAMERA`, `POST_NOTIFICATIONS`, `REQUEST_INSTALL_PACKAGES`, `RECEIVE_BOOT_COMPLETED` nicht; Intent-Filter `lifeline://verbinden` (exportiert) und `lifeline://anmeldung` (für Custom-Tab-Rückfall); Receiver `ACTION_MY_PACKAGE_REPLACED`; `networkSecurityConfig` mit `system` und `user`, `cleartextTrafficPermitted="false"`. Thema: Kopf-Schwarz aus der Marke, helle Statusleiste-Symbole, randlos mit Insets. Symbol aus der Bildmarke per Skript (wie `scripts/ios/erzeuge-symbol.sh`), Marken-Wächter kennt es.
- [ ] **Step 4: Lauf grün** — beide Läufe PASS; Bild liegt vor. Android-SDK lokal: `sdkmanager "platforms;android-36" "build-tools;36.0.0"` im Scratchpad, `ANDROID_HOME` gesetzt.
- [ ] **Step 5: Commit** `feat(android): App-Gerüst mit Version, Marke und Bildlauf (LLH-1989)`

### Task 11: Native Seiten: Onboarding mit QR, Serverliste, Einstellungen, Status

**Files:**
- Create: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/seiten/{OnboardingSeite,QrScanner,ServerlisteSeite,EinstellungenSeite,StatusSeite,UpdateSeite}.kt`
- Modify: `AppModell.kt`, `BilderTest.kt`

**Interfaces:**
- Consumes: `Onboarding`, `Serverliste`, `Serverentfernung`, `Statusseite.text`, `Updatestand`, `Testzustand`
- Produces: Compose-Funktionen `OnboardingSeite(state: Onboarding.State, onEvent: (Onboarding.Event) -> Unit, onScan: () -> Unit)`, `ServerlisteSeite(liste: Serverliste, seite: Ablauf.Seite, …)`, `EinstellungenSeite(haptik: Boolean, onHaptik: (Boolean) -> Unit, version: String, kanal: Kanal?, stand: Updatestand, onPruefen: () -> Unit, onInstallieren: () -> Unit)`, `StatusSeite(text: Statustext, onErneut: () -> Unit, onServerliste: () -> Unit, onUpdate: (() -> Unit)?)`, `UpdateSeite()` („Lifeline wird aktualisiert“)

- [ ] **Step 1: Failing tests** — `BilderTest` je Testzustand ein Bild (`onboarding`, `serverliste`, `einstellungen`, `zertifikat`, `nicht-erreichbar`, `zu-alt`, `zu-neu`, `webview-veraltet`, `update-bereit`, `update-laeuft`) in Hoch- (Handy 411×891 dp) und Querformat (Tablet 1280×800 dp); Robolectric-Test `` `Entfernen fragt mit dem Hinweis auf verlorene Einträge` `` (Text `Serverentfernung.HINWEIS` sichtbar), `` `aktiver Server bietet kein Entfernen` ``.
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Seiten umsetzen** im Stil der iOS-Seiten (`ios/App/Seiten/`), Inhaltsbreite auf Tablets begrenzt (max. 560 dp). QR: CameraX + ML Kit Barcode (gebündelt), Kameraberechtigung erst beim Scannen; Inhalt → `Deeplink.adresseAusQrCode` → `Onboarding.Event.Vorbelegen`.
- [ ] **Step 4: Lauf grün**, Bilder ansehen.
- [ ] **Step 5: Commit** `feat(android): native Seiten der Hülle (LLH-1989)`

### Task 12: WebView je Server, Vertragsabruf, Brücke, Linkweiche, Lebenszyklus

**Files:**
- Create: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/{WebviewFabrik,HuellenClient,HuellenChromeClient,Brueckenempfang,Vertragsabruf,Fehlerzuordnung}.kt`
- Modify: `AppModell.kt`, `MainActivity.kt`
- Test: `android/app/src/test/kotlin/dev/rubeen/lifeline/android/{FehlerzuordnungTest,VertragsabrufTest,AppModellTest}.kt`

**Interfaces:**
- Consumes: `Ablauf`, `Vertragspruefung`, `Linkweiche`, `Bruecke`, `Initskript`, `Huellenstil`, `Serverentfernung`
- Produces: `object WebviewFabrik { fun isTauglich(): Boolean /* MULTI_PROFILE, WEB_MESSAGE_LISTENER, DOCUMENT_START_SCRIPT */; fun build(context: Context, eintrag: ServerEintrag, …): WebView }` (Profil = `eintrag.id` vor jeder Nutzung, Start-Skripte `huelle.js` gerendert + `Huellenstil.skript` mit `Bruecke.allowedOriginRule`, Listener `lifeline` mit derselben Regel, prüft `Bruecke.accepts(isMainFrame, SeitenOrigin.parse(origin), aktiverServer)` bei jeder Nachricht)
- Produces: `object Fehlerzuordnung { fun netzfehler(e: IOException): Netzfehler; fun netzfehler(webViewErrorCode: Int): Netzfehler }` (`SSLHandshakeException`/`CertPathValidatorException` → `ZERTIFIKAT`; `WebViewClient.ERROR_FAILED_SSL_HANDSHAKE` → `ZERTIFIKAT`; sonst `VERBINDUNG`)
- Produces: `class Vertragsabruf { suspend fun abrufen(server: ServerAdresse): Pair<ShellAbruf, String?> }` (`GET /api/shell`, bei 404 `GET /api/health`; Weiterleitung nur nach `Vertragspruefung.followsRedirect`; Zeitlimit 10 s)

- [ ] **Step 1: Failing tests** — `FehlerzuordnungTest` (Ausnahmen und Codes); `VertragsabrufTest` mit `MockWebServer` (200 JSON, 404 + health, 302 auf fremde Origin → als Antwort 302); `AppModellTest` (Robolectric): `` `Wechsel baut den WebView mit dem Profil des neuen Servers` `` (Attrappen-Fabrik meldet den Profilnamen), `` `ohne taugliches WebView kein WebView` ``, `` `Zurück geht im WebView zurück, sonst in den Hintergrund` `` (`moveTaskToBack` aufgerufen, Activity nicht beendet).
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen.** `HuellenClient`: `shouldOverrideUrlLoading` → `Linkweiche.navigation(…, neuesFenster=false)`; `onCreateWindow` → `neuesFenster=true`; `onReceivedSslError` → `handler.cancel()` und `Event.NavigationFehlgeschlagen(ZERTIFIKAT, url)`; `onReceivedError` nur Hauptframe; `onRenderProcessGone` → `Event.WebProzessBeendet` (WebView neu bauen) und `true`; `onPageCommitVisible` → `SeiteGeladen`. WebView: `overScrollMode = OVER_SCROLL_NEVER`, JS und DOM-Storage an, Insets per `WindowInsetsCompat` als Polster, Hintergrund Kopf-Schwarz. Lebenszyklus → `Rueckkehr`; Vordergrund fragt per `evaluateJavascript("1")` mit Zeitlimit 2 s, ob die Seite antwortet. „Zur Oberfläche“ als kleiner nativer Knopf über dem WebView. Serverliste-Knopf am Rand. Entfernen: WebView zerstören, dann `ProfileStore.getInstance().deleteProfile(id)`.
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): WebView je Server mit Brücke und Vertragsprüfung (LLH-1989)`

### Task 13: Systemdienste: Haptik, Meldung, Druck, Downloads, Dialoge, Anmeldung

**Files:**
- Create: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/dienste/{Systemdienste,Downloads,Anmelder}.kt`
- Modify: `HuellenChromeClient.kt`, `MainActivity.kt`
- Test: `android/app/src/test/kotlin/dev/rubeen/lifeline/android/{SystemdiensteTest,AnmelderTest,DownloadsTest}.kt`

**Interfaces:**
- Consumes: `Huellendienste`, `Brueckenausfuehrung`, `Haptik`, `Anmeldung`, `Anmeldelauf`, `Seitendialog`, `Downloadablage`, `Linkweiche`
- Produces: `class Systemdienste(activity, view): Huellendienste` — Haptik: `CONFIRM` → `HapticFeedbackConstants.CONFIRM`, `REJECT` → `REJECT`, `WARNING` → `LONG_PRESS`, `SELECTION` → `SEGMENT_TICK` (API 34+, sonst `CLOCK_TICK`), `TAP` → `KEYBOARD_TAP`; unter API 30 `CONFIRM`/`REJECT` → `VIRTUAL_KEY`/`LONG_PRESS`. Meldung über einen Kanal „Lifeline“, Berechtigung `POST_NOTIFICATIONS` ab API 33. Druck: `PrintManager.print(name, webView.createPrintDocumentAdapter(name), null)`.
- Produces: `class Downloads` — `DownloadListener` für `http(s)` (Cookies aus dem `CookieManager` des Profils, Datei nach `cacheDir/<uuid>/<Downloadablage.dateiname>`, dann Teilen-Intent über `FileProvider`); `saveDownload` für `download_blob` (Task 6/9) legt die Bytes ebenso ab und teilt sie.
- Produces: `class Anmelder` — startet `AuthTabIntent` (androidx.browser 1.10, Rückruf-Schema `lifeline`) bzw. Custom Tab, merkt `verifier` im `Anmeldelauf`, wertet den Rücksprung nur aus, solange `isLaufend`, sonst nichts; Ergebnis über `Anmeldung.folge` → `evaluateJavascript(einloeseSkript|meldungSkript)`.

- [ ] **Step 1: Failing tests** — `SystemdiensteTest` (Robolectric: Zuordnung je `Feedback` und API-Stufe; Haptik aus → kein Aufruf), `AnmelderTest` (`` `ein Rücksprung ohne laufende Anmeldung bleibt wirkungslos` ``, `` `Abbruch meldet abgebrochen` ``), `DownloadsTest` (Dateiname bereinigt, Datei im eigenen Verzeichnis, `saveDownload` teilt die Datei).
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen.** `HuellenChromeClient`: `onJsAlert/Confirm/Prompt` → `Seitendialog` als `AlertDialog`.
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Systemdienste und Anmeldung im Browser (LLH-1989)`

### Task 14: Updater

**Files:**
- Create: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/update/{Updater,UpdatePruefung,Installation,PaketErsetzt}.kt`
- Modify: `AppModell.kt`, `EinstellungenSeite.kt`, `AndroidManifest.xml`
- Test: `android/app/src/test/kotlin/dev/rubeen/lifeline/android/UpdaterTest.kt`

**Interfaces:**
- Consumes: `Kanal`, `Updatemanifest`, `Updateentscheidung`, `Installzeitpunkt`, `Updatestand`
- Produces: `class Updater(context, http, uhr)` mit `suspend fun pruefen(erzwingen: Boolean = false): Updatestand`, `fun installieren(lage: Installzeitpunkt.Lage)`, `val stand: StateFlow<Updatestand>`; Kanal in `SharedPreferences("lifeline")` unter `kanal`, beim ersten Start aus `BuildConfig.VERSION_NAME` gesetzt, nie überschrieben. `UpdatePruefung`: `PeriodicWorkRequest` (4 h, Netz nötig) + Prüfung bei Start/Vordergrund; Hintergrund-Installation über `OneTimeWorkRequest` mit 15 min Verzögerung nach `ON_STOP`, abgebrochen bei `ON_START`. `Installation`: `PackageInstaller`-Sitzung, `setRequireUserAction(USER_ACTION_NOT_REQUIRED)` ab API 31, `canRequestPackageInstalls()` sonst → `ERLAUBNIS_FEHLT`; `STATUS_PENDING_USER_ACTION` im Hintergrund → `BEREIT` (Hinweis); `STATUS_FAILURE_BLOCKED` → `BLOCKIERT`. `PaketErsetzt`: Receiver `MY_PACKAGE_REPLACED` → Meldung „Lifeline aktualisiert – zum Öffnen tippen“.

- [ ] **Step 1: Failing tests** (Robolectric, `MockWebServer` statt GitHub über injizierte Basis-URL): `` `Manifest mit neuerer Version lädt und prüft die Prüfsumme` `` (falsche `sha256` → `FEHLER`, Datei gelöscht); `` `Download von fremdem Host wird nicht geladen` ``; `` `Kanal bleibt nach einem Update auf stabil Alpha` `` (Prefs `kanal=alpha`, `VERSION_NAME=1.0.0` → bleibt `ALPHA`); `` `ohne Kanal keine Prüfung` ``; `` `Start mit bereitem Update zeigt die Seite Lifeline wird aktualisiert` ``.
- [ ] **Step 2: Lauf rot.**
- [ ] **Step 3: Umsetzen.** Start: liegt ein geprüftes Update bereit, entscheidet `Installzeitpunkt.decide(START_VOR_OBERFLAECHE, …)` vor `Ablauf.Event.Start`; `Updatestand.BEREIT` zeigt einen Punkt am Serverliste-Knopf und einen Eintrag in den Einstellungen.
- [ ] **Step 4: Lauf grün.**
- [ ] **Step 5: Commit** `feat(android): Updater mit Installation außerhalb der Arbeit (LLH-1989)`

### Task 15: CI und Auslieferung

**Files:**
- Create: `.github/workflows/android-pruefung.yml`, `.github/workflows/android.yml`, `scripts/release/android-kanal.mjs` (+ `.test.mjs`), `scripts/android/sdk-version.sh` (eine Stelle für JDK-, SDK- und Build-Tools-Version)
- Modify: `.github/workflows/artefakte.yml` (Job `android` nach `freigeben`), `.github/workflows/suiten.yml` (Job `android`), `scripts/check-all.sh` (Schritt 8: `android-kanal.test.mjs`)

**Interfaces:**
- Consumes: `scripts/android/version.sh`, `scripts/release/pr-kommentare.mjs` (`kanalVon`, `vergleicheVersion`), Muster von `desktop-kanal.mjs` und `ios.yml`
- Produces: `node scripts/release/android-kanal.mjs --kanaele-fuer <version>` → je Zeile `android-alpha`/`android-beta` (Alpha: nur alpha; Beta: nur beta; stabil: beide); `--apk-ersetzen <kanal> <version>` → `ja` nur, wenn die Version zum Kanal gehört; `--kanal <k> --neu <android.json> [--alt <android.json>]` → `hochladen` nur bei SemVer-größer, sonst `behalten`.

- [ ] **Step 1: Failing tests** `android-kanal.test.mjs`: die drei Formen, darunter `` `stabil ersetzt die APK im Alpha-Kanal nicht` `` und `` `älteres Release dreht den Kanal nicht zurück` ``.
- [ ] **Step 2: Lauf rot** — `mise exec -- node --test scripts/release/android-kanal.test.mjs` → FAIL.
- [ ] **Step 3: Skript und Workflows.** `android-pruefung.yml`: `pull_request` mit Pfadfilter `android/**`, `src-tauri/faelle/**`, `scripts/android/**` und `push` auf `alpha`; JDK per `actions/setup-java` (Version aus `sdk-version.sh`), SDK vorinstalliert; `./android/gradlew -p android :app:testDebugUnitTest :app:assembleRelease` (unsigniert), Bilder als Artefakt `android-bilder`. `suiten.yml`: Job `android` mit `ANDROID_KERN_PFLICHT=1 ./scripts/check-all.sh --nur android`. `android.yml` (`workflow_call` mit `tag`, dazu `workflow_dispatch`): Version per `version.sh`, Keystore aus Geheimnissen (fehlt eins → Job rot mit Hinweis auf `docs/betrieb/android-app.md`), `assembleRelease` signiert, `apksigner verify`, Assets ans Release, `android.json` und feste APK nach `android-kanal.mjs`; Nebenläufigkeit je Kanal. `artefakte.yml`: Job `android` wie `ios` (hängt an `freigeben`, in keinem `needs` davor). Actions per SHA gepinnt wie im Bestand.
- [ ] **Step 4: Lauf grün** — Test PASS; `actionlint` (falls im Gate) und `./scripts/check-all.sh --nur schnell` → OK.
- [ ] **Step 5: Commit** `ci(android): Prüfung im PR und APK an jedem freigegebenen Tag (LLH-1989)`

### Task 16: Regeln und Doku

**Files:**
- Create: `android/AGENTS.md`, `docs/architektur/entscheidungen/ADR-00NN-die-android-huelle-ist-eine-eigene-kotlin-app-ohne-anwendungslogik-und-kommt-als-apk-die-sich-selbst-aktualisiert.md` (nächste freie Nummer, gegen offene PRs geprüft), `docs/betrieb/android-app.md`
- Modify: `AGENTS.md` (Tabellenzeile), `scripts/check-architektur.sh` (+ Test: Teilprojekt `android`, Teile `android/<teil>`), `docs/architektur/0{5,7,8}-*.md`, `docs/architektur/11-risiken-und-technische-schulden.md`, `docs/betrieb/endgeraete.md`, `src-tauri/AGENTS.md` („Gemeinsame Fälle“: Kotlin-Kern als dritter Leser), `src-tauri/faelle/*.json` (`zweck` nennt `android/kern`)

- [ ] **Step 1: Failing check** — `./scripts/check-architektur.sh` und ADR-Prüfung (`scripts/check-all.sh --nur schnell`) zeigen das fehlende Teilprojekt bzw. die neue ADR ohne Prüfung.
- [ ] **Step 2: Schreiben.** `android/AGENTS.md` mit den Regeln aus Entwurf D11. ADR mit Regeln (MUST: Kern ohne SDK testbar; MUST: ein Profil je Server, nie Rückfall; MUST: Updater installiert nie bei Oberfläche im Vordergrund; MUST: APK nur über GitHub-Releases; MUST: Signierschlüssel wechselt nie) und Prüfung (`verlange`-Zeilen gegen `Installzeitpunkt.kt`, `WebviewFabrik.kt`, `android.yml`). Betriebsdoku: Installation je Kanal mit Link und QR-Inhalt, „Unbekannte Apps installieren“, Samsung Auto Blocker, CA-Zertifikat, Signierschlüssel anlegen (`keytool -genkeypair -v -keystore lifeline-android.jks -alias lifeline -keyalg RSA -keysize 4096 -validity 36500`, Base64 als Geheimnis, Sicherung außerhalb von GitHub), Verhalten der Updates, Grenzen, Prüfliste für die erste Alpha auf einem Galaxy Tab (Android-, One-UI-, WebView-Version, Auto Blocker, zwei Server getrennt, Flugmodus-Kaltstart, Update ohne Rückfrage ab dem zweiten).
- [ ] **Step 3: Prüfen** — `./scripts/check-all.sh --nur schnell` → OK.
- [ ] **Step 4: Commit** `docs(android): Regeln, ADR und Betriebsdoku der Android-Hülle (LLH-1989)`

### Task 17: Abschluss

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → OK (Ausgabe für „Geprüft“ im PR).
- [ ] **Step 2:** `android/gradlew -p android :app:testDebugUnitTest :app:assembleRelease` lokal → OK; Bilder für den PR aus `android/app/build/bilder/`.
- [ ] **Step 3:** Review nach Ermessen (Anlass: Eingaben von außen über Brücke und Deeplink, Größe > 600 Zeilen).
