package dev.rubeen.lifeline.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.rubeen.lifeline.android.dienste.Anmelder
import dev.rubeen.lifeline.android.dienste.Downloads
import dev.rubeen.lifeline.android.update.Installation
import dev.rubeen.lifeline.android.update.Updater
import dev.rubeen.lifeline.android.web.Brueckenempfang
import dev.rubeen.lifeline.android.web.HuellenChromeClient
import dev.rubeen.lifeline.android.web.HuellenClient
import dev.rubeen.lifeline.android.web.Vertragsabruf
import dev.rubeen.lifeline.android.web.WebviewFabrik
import dev.rubeen.lifeline.android.web.Webviewbegleitung
import dev.rubeen.lifeline.android.web.uri
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Anmeldung
import dev.rubeen.lifeline.kern.Deeplink
import dev.rubeen.lifeline.kern.EntfernungException
import dev.rubeen.lifeline.kern.Entfernungsdienste
import dev.rubeen.lifeline.kern.Fehlerklasse
import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Huellendienste
import dev.rubeen.lifeline.kern.Initskript
import dev.rubeen.lifeline.kern.Installzeitpunkt
import dev.rubeen.lifeline.kern.Kanal
import dev.rubeen.lifeline.kern.ListException
import dev.rubeen.lifeline.kern.Onboarding
import dev.rubeen.lifeline.kern.Rueckkehr
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.ServerEintrag
import dev.rubeen.lifeline.kern.Serverablage
import dev.rubeen.lifeline.kern.Serverentfernung
import dev.rubeen.lifeline.kern.Serverliste
import dev.rubeen.lifeline.kern.ShellAbruf
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.Testzustand
import dev.rubeen.lifeline.kern.Updatestand
import dev.rubeen.lifeline.kern.Vertragspruefung
import java.io.IOException
import java.net.URI
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Zustand der App als Compose-State und Ausführung der Wirkungen, die die Zustandsfunktionen des
 * Kerns verlangen (wie `ios/App/AppModell.swift`): `Ablauf` für die Seite, `Onboarding` für die
 * Eingabe, `Serverentfernung` fürs Entfernen. Entscheidungen fallen im Kern; hier stehen nur Netz,
 * WebView, Ablage und Zeitgeber. Alles läuft im Hauptfaden ([scope]). In einem [testzustand]
 * fragt das Modell kein Netz und speichert nichts.
 *
 * @param version volle Version der App (`versionName`), [build] ihr `versionCode`
 * @param einstellungen Ablage der Schalter (`SharedPreferences("lifeline")`); im Testzustand `null`
 * @param context baut die WebViews (die Activity)
 * @param fabrik baut den WebView je Server; die Tests setzen eine Attrappe ein
 * @param ablage Serverliste auf dem Gerät; im Testzustand `null`
 * @param abrufen `GET /api/shell` (bei 404 dazu `/api/health`), [Vertragsabruf]
 * @param dienste Systemdienste der Brücke
 * @param oeffne öffnet eine Adresse im System
 * @param downloads lädt Dateirouten und Downloads des WebViews mit der Sitzung des Profils
 * @param anmelder „Im Browser anmelden“; nimmt den Rücksprung `lifeline://anmeldung` an
 * @param updater prüft, lädt und installiert Updates (Entwurf D9); im Testzustand `null`
 */
class AppModell(
    val testzustand: Testzustand?,
    version: String,
    build: Int,
    private val einstellungen: SharedPreferences?,
    private val scope: CoroutineScope,
    private val context: Context,
    private val fabrik: WebviewFabrik,
    private val ablage: Serverablage? = null,
    private val abrufen: suspend (ServerAdresse) -> Pair<ShellAbruf, String?> = Vertragsabruf()::abrufen,
    dienste: Huellendienste,
    private val oeffne: (URI) -> Unit = {},
    private val downloads: Downloads? = null,
    private val anmelder: Anmelder? = null,
    private val updater: Updater? = null,
) : Entfernungsdienste {
    val appVersion: String = if (testzustand != null) BEISPIEL_VERSION else version
    val build: String = (if (testzustand != null) BEISPIEL_BUILD else build).toString()

    /** Kanal des Updaters; im Testzustand der Kanal der Beispielversion. */
    val kanal: Kanal? = if (testzustand != null) Kanal.fromVersion(appVersion) else updater?.kanal

    var seite: Ablauf.Seite by mutableStateOf(Ablauf.Seite.Onboarding)
        private set
    var onboarding: Onboarding.State by mutableStateOf(Onboarding.State.START)
        private set
    var liste: Serverliste by mutableStateOf(ablage?.loadOrRecover() ?: Serverliste())
        private set
    var updatestand: Updatestand by mutableStateOf(Updatestand.KEINS)
        private set

    // Native Seiten über der Seite des Ablaufs (auf iOS Blätter); Zurück schließt die oberste.
    var zeigtServerliste by mutableStateOf(false)
    var zeigtEinstellungen by mutableStateOf(false)
    var zeigtOnboarding by mutableStateOf(false)

    /** „Lifeline wird aktualisiert“ vor einer Installation beim Start (Entwurf D9). */
    var zeigtUpdate by mutableStateOf(false)
        private set

    var haptik: Boolean by mutableStateOf(einstellungen?.getBoolean(Haptik.SCHALTER_SCHLUESSEL, true) ?: true)
        private set

    /** Server, dessen Daten gerade gelöscht werden; zu ihm wechselt die App nicht. */
    var inEntfernung: String? by mutableStateOf(null)
        private set

    /** Meldung, wenn sich ein Server nicht entfernen ließ. */
    var entfernenFehler: String? by mutableStateOf(null)
        private set

    /** Der WebView des aktiven Servers; nur solange die Seite `Web` ist. */
    var webView: WebView? by mutableStateOf(null)
        private set

    /** Hinweis „Zur Oberfläche“ über dem WebView (`Ablauf`: fremde Seite nach der Rückkehr). */
    var zeigtZurOberflaeche by mutableStateOf(false)
        private set

    /** Version aus `/api/health`, wenn ein Server im Onboarding keinen Vertrag kennt. */
    var onboardingHealthVersion: String? by mutableStateOf(null)
        private set

    /** Ein Deeplink nennt einen gespeicherten, nicht aktiven Server: wechseln erst nach Rückfrage. */
    var wechselRueckfrage: ServerEintrag? by mutableStateOf(null)

    /** Läuft „Im Browser anmelden“? Dann bleibt eine fremde Seite ohne Hinweis stehen. */
    private val anmeldungLaeuft: Boolean
        get() = anmelder?.isLaufend == true

    /** Profil des [webView] (die Id seines Eintrags). */
    private var webViewProfil: String? = null

    /** Der Render-Prozess des [webView] ist beendet; neu laden heißt neu bauen. */
    private var webViewBeendet = false

    private var wiederholung: Job? = null
    private val rueckkehr = Rueckkehr()
    private var gestartet = false

    /** `Ablauf.Event.Start` ist gesendet; ein Update beim Start schiebt ihn auf. */
    private var ablaufGestartet = false

    private val client = HuellenClient(
        aktiverServer = { liste.aktiv?.adresse },
        melde = ::melde,
        oeffne = { oeffne(it) },
        herunterladen = { view, ziel -> downloads?.herunterladen(view, ziel.toString(), null, null) },
    )
    private val chromeClient = HuellenChromeClient(client::neuesFenster)
    private val empfang = Brueckenempfang(
        dienste = dienste,
        aktiverServer = { liste.aktiv?.adresse },
        isAktuell = { it === webView },
        scope = scope,
    )

    /** `huelle.js` aus den Assets mit der Version der App (Entwurf D4). */
    private val initskript: String by lazy {
        val vorlage = try {
            context.assets.open(INITSKRIPT).bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: IOException) {
            Log.e(TAG, "$INITSKRIPT fehlt in den Assets der App", e)
            ""
        }
        Initskript.render(vorlage, appVersion)
    }

    init {
        testzustand?.let(::zeige)
        updater?.let { updater ->
            scope.launch {
                updater.stand.collect { stand ->
                    updatestand = stand
                    // Die Installation kam nicht zustande (abgelehnt, gesperrt, Fehler): weiter wie sonst.
                    if (zeigtUpdate && stand != Updatestand.INSTALLIERT_GLEICH) {
                        zeigtUpdate = false
                        starteAblauf()
                    }
                }
            }
        }
    }

    /**
     * Einmal, sobald die Activity steht: der Start des Ablaufs mit dem aktiven Server; im
     * Testzustand die Beispielseite.
     */
    fun start() {
        if (gestartet) return
        gestartet = true
        if (testzustand != null) {
            zeigeBeispielseite(testzustand)
            return
        }
        // Ein bereites Update installiert die App vor der Oberfläche (Entwurf D9, Fall a), sichtbar
        // als „Lifeline wird aktualisiert“; ob, entscheidet `Installzeitpunkt` im Updater.
        if (updater != null && updater.stand.value == Updatestand.BEREIT) {
            zeigtUpdate = true
            scope.launch {
                if (updater.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) != Installzeitpunkt.Weg.INSTALLIEREN) {
                    zeigtUpdate = false
                    starteAblauf()
                }
            }
            return
        }
        starteAblauf()
    }

    private fun starteAblauf() {
        if (ablaufGestartet) return
        ablaufGestartet = true
        send(Ablauf.Event.Start(liste.aktiv, fabrik.isTauglich()))
    }

    /** Die Activity endet: der WebView geht mit. */
    fun beenden() {
        wiederholung?.cancel()
        closeWebView()
    }

    /** Liegt eine native Seite über der Seite des Ablaufs? Dann schließt Zurück sie. */
    val hatBlatt: Boolean
        get() = zeigtEinstellungen || zeigtOnboarding || zeigtServerliste

    /** Schließt die oberste native Seite (Einstellungen und Hinzufügen liegen über der Liste). */
    fun zurueck() {
        when {
            zeigtEinstellungen -> zeigtEinstellungen = false
            zeigtOnboarding -> zeigtOnboarding = false
            else -> zeigtServerliste = false
        }
    }

    /**
     * System-Zurück (Entwurf D6): schließt die oberste native Seite, sonst geht der WebView zurück,
     * solange er kann. `false`: nichts mehr zurück, die App geht in den Hintergrund.
     */
    fun zurueckTaste(): Boolean {
        if (zeigtUpdate) return false
        if (hatBlatt) {
            zurueck()
            return true
        }
        val webView = webView
        if (seite is Ablauf.Seite.Web && webView != null && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return false
    }

    // Onboarding

    fun send(event: Onboarding.Event) {
        val schritt = Onboarding.next(onboarding, event)
        onboarding = schritt.state
        when (val effect = schritt.effect) {
            is Onboarding.Effect.Check -> {
                onboardingHealthVersion = null
                if (testzustand != null) return
                scope.launch {
                    val (abruf, health) = abrufen(effect.adresse)
                    onboardingHealthVersion = health
                    send(Onboarding.Event.Ergebnis(Vertragspruefung.evaluate(abruf, letzterVertrag = null), effect.adresse))
                }
            }
            is Onboarding.Effect.Save -> {
                val (mitNeuem, eintrag) = liste.add(effect.adresse) { UUID.randomUUID().toString() }
                liste = try {
                    mitNeuem.activate(eintrag.id)
                } catch (_: ListException) {
                    mitNeuem
                }
                save()
                zeigtOnboarding = false
                zeigtServerliste = false
                onboarding = Onboarding.State.START
                send(Ablauf.Event.Verbunden(liste.aktiv ?: eintrag, effect.info))
            }
            null -> Unit
        }
    }

    // Ablauf

    fun send(event: Ablauf.Event) {
        val schritt = Ablauf.next(seite, event)
        seite = schritt.seite
        val web = seite as? Ablauf.Seite.Web
        if (web == null) {
            closeWebView()
            zeigtZurOberflaeche = false
        }
        // Weiter geprüft wird nur auf „nicht erreichbar“ und in der Offline-Oberfläche.
        val prueftWeiter = (seite as? Ablauf.Seite.Status)?.status == Statusseite.NichtErreichbar || web?.offline == true
        if (!prueftWeiter) {
            wiederholung?.cancel()
            wiederholung = null
        }
        schritt.effects.forEach(::perform)
    }

    private fun perform(effect: Ablauf.Effect) {
        // Nur Anzeige: gilt auch im Testzustand, der sonst weder Netz noch Ablage anfasst.
        when (effect) {
            Ablauf.Effect.ShowZurOberflaeche -> zeigtZurOberflaeche = true
            Ablauf.Effect.HideZurOberflaeche -> zeigtZurOberflaeche = false
            else -> if (testzustand == null) performImBetrieb(effect)
        }
    }

    private fun performImBetrieb(effect: Ablauf.Effect) {
        when (effect) {
            is Ablauf.Effect.Check -> checkVertrag(effect.eintrag)
            // Auch offline (Entwurf D5): die Oberfläche kommt dann aus dem Service Worker.
            is Ablauf.Effect.Load -> load(effect.eintrag)
            Ablauf.Effect.Reload -> reload()
            is Ablauf.Effect.MarkVerbunden ->
                changeListe { it.markVerbunden(effect.id, zeit = System.currentTimeMillis(), vertrag = effect.vertrag) }
            is Ablauf.Effect.MarkGeladen -> changeListe { it.markGeladen(effect.id) }
            Ablauf.Effect.ScheduleRetry -> {
                wiederholung?.cancel()
                wiederholung = scope.launch {
                    delay(Ablauf.WIEDERHOL_INTERVALL_MS)
                    send(Ablauf.Event.Wiederholen)
                }
            }
            Ablauf.Effect.ShowZurOberflaeche, Ablauf.Effect.HideZurOberflaeche -> Unit
        }
    }

    private fun checkVertrag(eintrag: ServerEintrag) {
        val letzterVertrag = aktuell(eintrag).bestaetigterVertrag
        scope.launch {
            val (abruf, health) = abrufen(eintrag.adresse)
            send(Ablauf.Event.Ergebnis(Vertragspruefung.evaluate(abruf, letzterVertrag), health, fuer = eintrag.id))
        }
    }

    /** Neuer WebView im Profil des Eintrags (Entwurf D3), dann seine Startadresse. */
    private fun load(eintrag: ServerEintrag) {
        closeWebView()
        build(eintrag).loadUrl(eintrag.adresse.text)
    }

    private fun reload() {
        val eintrag = seite.eintrag ?: return
        val webView = webView
        when {
            // Nach dem Ende des Render-Prozesses taugt der alte WebView nicht mehr (Entwurf D6).
            webView == null || webViewBeendet -> load(eintrag)
            webView.url != null -> webView.reload()
            else -> webView.loadUrl(eintrag.adresse.text)
        }
    }

    private fun build(eintrag: ServerEintrag): WebView {
        val begleitung = Webviewbegleitung(initskript, client, chromeClient, empfang, downloads?.let { it::herunterladen })
        val neu = fabrik.build(context, eintrag, begleitung)
        webView = neu
        webViewProfil = eintrag.id
        webViewBeendet = false
        return neu
    }

    private fun closeWebView() {
        val alt = webView ?: return
        webView = null
        webViewProfil = null
        webViewBeendet = false
        fabrik.close(alt)
    }

    /** Meldungen des WebViews; die eines schon verworfenen zählen nicht. */
    private fun melde(view: WebView, event: Ablauf.Event) {
        if (view !== webView) return
        if (event == Ablauf.Event.WebProzessBeendet) webViewBeendet = true
        send(event)
    }

    // Vordergrund

    /**
     * Phase der Activity. Bei der Rückkehr aus dem Hintergrund fragt die App, ob die Seite noch
     * antwortet, und meldet `Vordergrund`; `Ablauf` entscheidet, ob neu geprüft oder gebaut wird.
     */
    fun phase(phase: Rueckkehr.Phase) {
        if (!rueckkehr.melde(phase) || testzustand != null) return
        val gefragt = webView
        // Jetzt, nicht nach der Antwortfrist: ein abgebrochener Custom Tab endet in ihr.
        val laeuft = anmeldungLaeuft
        scope.launch {
            val antwortet = gefragt?.let { isResponsive(it) } ?: false
            send(Ablauf.Event.Vordergrund(antwortet, gefragt?.url?.let(::uri), laeuft))
        }
    }

    /** Antwortet die Seite binnen [ANTWORT_FRIST_MS]? Ein beendeter Render-Prozess antwortet nie. */
    private suspend fun isResponsive(webView: WebView): Boolean {
        if (webView.url == null) return false
        return withTimeoutOrNull(ANTWORT_FRIST_MS) {
            suspendCancellableCoroutine { fortsetzung ->
                webView.evaluateJavascript("1") { wert -> if (fortsetzung.isActive) fortsetzung.resume(wert == "1") }
            }
        } ?: false
    }

    // Zur Oberfläche

    /** Bietet die Serverliste „Zur Oberfläche“ an? Entscheidet `Ablauf`. */
    val bietetZurOberflaeche: Boolean
        get() = Ablauf.bietetZurOberflaeche(seite)

    /** Der Hinweis über dem WebView ist weggetippt; die fremde Seite bleibt. */
    fun verwerfeZurOberflaeche() {
        zeigtZurOberflaeche = false
    }

    // Serverliste

    /** Weiterer Server aus der Liste: Onboarding als Blatt, von vorn. */
    fun zeigeHinzufuegen() {
        onboarding = Onboarding.State.START
        zeigtOnboarding = true
    }

    /** Tipp auf den aktiven Server: lädt seine Startadresse neu. */
    fun zurOberflaeche() {
        zeigtServerliste = false
        send(Ablauf.Event.ZurOberflaeche)
    }

    fun wechseln(eintrag: ServerEintrag) {
        wechselRueckfrage = null
        if (eintrag.id == inEntfernung) return
        zeigtServerliste = false
        liste = try {
            liste.activate(eintrag.id)
        } catch (_: ListException) {
            Log.e(TAG, "Wechsel auf einen unbekannten Server")
            return
        }
        save()
        send(Ablauf.Event.Wechseln(liste.aktiv ?: eintrag))
    }

    /** „Erneut prüfen“ auf einer Status-Seite: prüft ihren Server sofort. */
    fun pruefeErneut() {
        seite.eintrag?.let { send(Ablauf.Event.Wechseln(aktuell(it))) }
    }

    fun umbenennen(eintrag: ServerEintrag, name: String) {
        changeListe { it.rename(eintrag.id, name) }
    }

    /** Nach der Rückfrage: Reihenfolge und Fehler entscheidet `Serverentfernung` im Kern. */
    fun entfernen(eintrag: ServerEintrag) {
        if (inEntfernung != null) return
        inEntfernung = eintrag.id
        scope.launch {
            try {
                Serverentfernung.run(eintrag.id, this@AppModell)
            } catch (e: EntfernungException) {
                entfernenFehler = e.fehler.meldung
            } finally {
                inEntfernung = null
            }
        }
    }

    fun fehlerGesehen() {
        entfernenFehler = null
    }

    /** Der aktuelle Stand eines Eintrags (Name nach Umbenennen, zuletzt verbunden). */
    fun aktuell(eintrag: ServerEintrag): ServerEintrag = liste.eintraege.firstOrNull { it.id == eintrag.id } ?: eintrag

    /** Ändert die Liste und speichert sie; ein unbekannter Eintrag ändert nichts. */
    private fun changeListe(aenderung: (Serverliste) -> Serverliste) {
        liste = try {
            aenderung(liste)
        } catch (_: ListException) {
            return
        }
        save()
    }

    private fun save() {
        val ablage = ablage ?: return
        try {
            ablage.save(liste)
        } catch (e: Exception) {
            Log.e(TAG, "Serverliste nicht gespeichert", e)
        }
    }

    // Einstellungen

    fun schalteHaptik(an: Boolean) {
        haptik = an
        einstellungen?.edit()?.putBoolean(Haptik.SCHALTER_SCHLUESSEL, an)?.apply()
    }

    /**
     * „App aktualisieren“ führt direkt zum Updater (Entwurf D4): ein bereites Update installieren,
     * sonst suchen.
     */
    fun aktualisieren() {
        if (updatestand == Updatestand.BEREIT) installiereUpdate() else pruefeUpdate()
    }

    /** „Jetzt prüfen“: sofort, unabhängig vom Abstand der Prüfungen. */
    fun pruefeUpdate() {
        val updater = updater ?: return
        scope.launch { updater.pruefen(erzwingen = true) }
    }

    /**
     * „Jetzt installieren“ (der Hinweis): die Person entscheidet, die App zeigt „Lifeline wird
     * aktualisiert“. Fehlt die Erlaubnis, führt der Hinweis in die Systemeinstellung.
     */
    fun installiereUpdate() {
        val updater = updater ?: return
        when (updatestand) {
            Updatestand.ERLAUBNIS_FEHLT -> try {
                context.startActivity(Installation.erlaubnisIntent(context))
            } catch (e: ActivityNotFoundException) {
                Log.w(TAG, "Keine Systemeinstellung für unbekannte Apps", e)
            }
            Updatestand.BEREIT -> {
                zeigtUpdate = true
                scope.launch { updater.installierenAufWunsch() }
            }
            else -> Unit
        }
    }

    /**
     * Die Activity ist wieder sichtbar (`ON_START`): Erlaubnis neu lesen (vielleicht aus der
     * Systemeinstellung zurück) und prüfen, wenn es fällig ist.
     */
    fun imVordergrund() {
        val updater = updater ?: return
        updater.aktualisiereStand()
        scope.launch { updater.pruefen() }
    }

    // Entfernungsdienste

    override val serverliste: Serverliste
        get() = liste

    /** Schließt den WebView, wenn er das Profil benutzt; er gehört immer zum aktiven Server. */
    override fun closeWebView(profil: String) {
        if (webViewProfil == profil) closeWebView()
    }

    /** Im Testzustand bleibt jedes Profil, wie es ist. */
    override suspend fun removeProfil(profil: String) {
        if (testzustand != null) return
        fabrik.deleteProfil(profil)
    }

    override fun removeEintrag(id: String) {
        liste = liste.remove(id)
        save()
    }

    // Deeplink

    /**
     * Links von außen (Intent `ACTION_VIEW`, Entwurf D2). `lifeline://verbinden` geht in die
     * Entscheidung des Kerns: ein unbekannter Server wird im Onboarding vorbelegt, ein
     * gespeicherter erst nach Rückfrage gewechselt, der aktive bleibt. Den Rücksprung
     * `lifeline://anmeldung` nimmt nur eine laufende Anmeldung an ([Anmelder.ruecksprung]); sonst
     * bleibt er wirkungslos, wie jeder andere Link.
     */
    fun open(link: String) {
        if (isRuecksprung(link)) {
            anmelder?.ruecksprung(link)
            return
        }
        val adresse = Deeplink.parse(link) ?: return
        when (val aktion = Deeplink.decide(liste.aktiv?.adresse, liste.eintraege.map { it.adresse }, adresse)) {
            is Deeplink.Aktion.Vorbelegen -> {
                val alsBlatt = seite != Ablauf.Seite.Onboarding
                // Ein Blatt beginnt von vorn wie „Server hinzufügen“; offene Einstellungen verdecken es nicht.
                if (alsBlatt && !zeigtOnboarding) onboarding = Onboarding.State.START
                send(Onboarding.Event.Vorbelegen(aktion.adresse))
                if (alsBlatt) {
                    zeigtEinstellungen = false
                    zeigtOnboarding = true
                }
            }
            is Deeplink.Aktion.Bestaetigen -> wechselRueckfrage = liste.eintragFuer(aktion.adresse)
            Deeplink.Aktion.Nichts -> Unit
        }
    }

    /** `lifeline://anmeldung…`: Schema und Host des Rücksprungs, ob gültig oder nicht. */
    private fun isRuecksprung(link: String): Boolean {
        val uri = uri(link) ?: return false
        return uri.scheme.equals(Deeplink.SCHEMA, ignoreCase = true) && uri.rawAuthority == Anmeldung.RUECKSPRUNG_HOST
    }

    // Testzustände der Bilder

    private fun zeige(testzustand: Testzustand) {
        liste = beispielliste()
        val elw = liste.aktiv ?: return
        val nichtErreichbar = Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar)
        when (testzustand) {
            Testzustand.ONBOARDING -> {
                liste = Serverliste()
                seite = Ablauf.Seite.Onboarding
                onboarding = Onboarding.State.Eingabe("https://elw.local:8443", null)
            }
            Testzustand.SERVERLISTE -> {
                seite = nichtErreichbar
                zeigtServerliste = true
            }
            Testzustand.EINSTELLUNGEN -> {
                seite = nichtErreichbar
                zeigtEinstellungen = true
            }
            Testzustand.ZERTIFIKAT -> seite = Ablauf.Seite.Status(elw, Statusseite.Zertifikat)
            Testzustand.NICHT_ERREICHBAR -> seite = nichtErreichbar
            Testzustand.ZU_ALT ->
                seite = Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, "1.0.0-alpha.200"))
            Testzustand.ZU_NEU ->
                seite = Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0"))
            Testzustand.WEBVIEW_VERALTET -> seite = Ablauf.Seite.WebviewVeraltet
            Testzustand.UPDATE_BEREIT -> {
                seite = nichtErreichbar
                updatestand = Updatestand.BEREIT
                zeigtEinstellungen = true
            }
            Testzustand.UPDATE_LAEUFT -> {
                updatestand = Updatestand.INSTALLIERT_GLEICH
                zeigtUpdate = true
            }
            Testzustand.WEB, Testzustand.FREMDE_SEITE -> {
                // Den WebView baut `start()` (`zeigeBeispielseite`).
                seite = Ablauf.Seite.Web(elw, vertrag = 1)
                zeigtZurOberflaeche = testzustand == Testzustand.FREMDE_SEITE
            }
        }
    }

    /**
     * Die Beispielseite der Testzustände `web` und `fremde-seite` ohne Netz, mit Brücke und
     * Begleitern; die fremde Seite liegt unter einer anderen Origin.
     */
    private fun zeigeBeispielseite(testzustand: Testzustand) {
        if (testzustand != Testzustand.WEB && testzustand != Testzustand.FREMDE_SEITE) return
        val elw = (seite as? Ablauf.Seite.Web)?.eintrag ?: return
        if (!fabrik.isTauglich()) {
            seite = Ablauf.Seite.WebviewVeraltet
            zeigtZurOberflaeche = false
            return
        }
        val basis = if (testzustand == Testzustand.FREMDE_SEITE) "https://idp.example/" else elw.adresse.text
        build(elw).loadDataWithBaseURL(basis, Testzustand.BEISPIELSEITE, "text/html", "utf-8", null)
    }

    companion object {
        private const val TAG = "Lifeline"
        private const val INITSKRIPT = "huelle.js"

        /** Frist, in der eine Seite nach der Rückkehr auf `evaluateJavascript` antworten muss. */
        const val ANTWORT_FRIST_MS = 2_000L

        /** Version und Build der Bilder: eine Alpha, damit Kanal und Updater sichtbar sind. */
        const val BEISPIEL_VERSION = "1.0.0-alpha.7"
        const val BEISPIEL_BUILD = 469_044

        /** Beispielserver der Testzustände (wie auf iOS, dazu ein dritter). */
        fun beispielliste(): Serverliste {
            val ids = ArrayDeque(
                listOf(
                    "6f1c2a4e-0b7d-4c1e-9a53-2d8e4f0a1b01",
                    "6f1c2a4e-0b7d-4c1e-9a53-2d8e4f0a1b02",
                    "6f1c2a4e-0b7d-4c1e-9a53-2d8e4f0a1b03",
                ),
            )
            fun Serverliste.mit(adresse: String, name: String) =
                add(ServerAdresse.parse(adresse), name) { ids.removeFirst() }
            val (mitElw, elw) = Serverliste().mit("https://elw.local:8443", "ELW 1")
            val (mitLager, _) = mitElw.mit("https://lager.example", "Lager")
            val (alle, kv) = mitLager.mit("https://lifeline.kv.example", "Kreisverband")
            return alle
                .markVerbunden(elw.id, zeit = 1_800_000_000_000, vertrag = 1)
                .markVerbunden(kv.id, zeit = 1_799_400_000_000, vertrag = 1)
        }
    }
}
