package dev.rubeen.lifeline.kern

import java.net.URI

/**
 * Welche Seite die App zeigt und was sie dafür tut, als reine Zustandsfunktion (wie
 * `Ablauf.swift`, dazu Entwurf D3 „WebView zu alt“ und D5 „Start ohne Server“). Die App führt
 * die Wirkungen aus und meldet Ergebnisse als Ereignis zurück.
 */
object Ablauf {
    /** Abstand der Prüfungen auf der Seite „nicht erreichbar“ und der Offline-Oberfläche. */
    const val WIEDERHOL_INTERVALL_MS = 5_000L

    sealed interface Seite {
        /** Kein Server gespeichert. */
        data object Onboarding : Seite {
            override val eintrag: ServerEintrag? = null
        }

        /** `GET /api/shell` läuft; noch nichts geladen. */
        data class Pruefung(override val eintrag: ServerEintrag) : Seite

        /**
         * Die Oberfläche des Servers im WebView. [offline]: der Server antwortete nicht, die
         * Oberfläche kommt aus dem Service Worker (Entwurf D5); die App prüft weiter.
         */
        data class Web(override val eintrag: ServerEintrag, val vertrag: Int, val offline: Boolean = false) : Seite

        data class Status(override val eintrag: ServerEintrag, val status: Statusseite) : Seite

        /** Der System-WebView ist zu alt für getrennte Profile (Entwurf D3). */
        data object WebviewVeraltet : Seite {
            override val eintrag: ServerEintrag? = null
        }

        /** Der Server der Seite; `null` im Onboarding und bei „WebView veraltet“. */
        val eintrag: ServerEintrag?
    }

    sealed interface Event {
        /** Start der App mit dem aktiven Server der Liste; [webviewTauglich] sagt, ob der WebView Profile kann. */
        data class Start(val aktiv: ServerEintrag?, val webviewTauglich: Boolean) : Event

        /** Wechsel in der Serverliste oder nach bestätigtem Deeplink. */
        data class Wechseln(val eintrag: ServerEintrag) : Event

        /** Das Onboarding hat den Server geprüft und gespeichert. */
        data class Verbunden(val eintrag: ServerEintrag, val info: ShellInfo) : Event

        /**
         * Rückkehr in den Vordergrund; die App hat vorher gefragt, ob die Seite noch antwortet.
         * [adresse] ist die Adresse des WebViews, [anmeldungLaeuft] gilt, solange „Im Browser
         * anmelden“ eine Sitzung offen hat.
         */
        data class Vordergrund(val seiteAntwortet: Boolean, val adresse: URI?, val anmeldungLaeuft: Boolean) : Event

        /** „Zur Oberfläche“: zurück zur Startadresse des aktiven Servers. */
        data object ZurOberflaeche : Event

        /** Der WebView hat eine neue Seite übernommen (Commit). */
        data class SeiteGeladen(val url: URI?) : Event

        /** Ergebnis von `Check`; [healthVersion] nur für einen Server ohne Vertrag, [fuer] ist die Id des Eintrags. */
        data class Ergebnis(val ergebnis: Vertragsergebnis, val healthVersion: String?, val fuer: String) : Event

        /** Zeitgeber der Seite „nicht erreichbar“ und der Offline-Oberfläche. */
        data object Wiederholen : Event

        /** Die Hauptnavigation scheiterte an [url]. */
        data class NavigationFehlgeschlagen(val fehler: Netzfehler, val url: URI?) : Event

        /** Der Render-Prozess des WebViews endete. */
        data object WebProzessBeendet : Event
    }

    sealed interface Effect {
        /** `GET /api/shell` (bei 404 dazu `GET /api/health`) und [Vertragspruefung]. */
        data class Check(val eintrag: ServerEintrag) : Effect

        /** WebView mit dem Profil des Eintrags bauen und die Startadresse laden. */
        data class Load(val eintrag: ServerEintrag) : Effect

        data object Reload : Effect

        data class MarkVerbunden(val id: String, val vertrag: Int) : Effect

        /** Das Profil zeigte den Server zum ersten Mal (`ServerEintrag.geladenImProfil`). */
        data class MarkGeladen(val id: String) : Effect

        /** Nach [WIEDERHOL_INTERVALL_MS] `Wiederholen` melden. */
        data object ScheduleRetry : Effect

        /** Hinweis „Zur Oberfläche“ über dem WebView zeigen: er steht auf einer fremden Seite. */
        data object ShowZurOberflaeche : Effect

        data object HideZurOberflaeche : Effect
    }

    data class Step(val seite: Seite, val effects: List<Effect> = emptyList())

    fun next(seite: Seite, event: Event): Step {
        if (event is Event.Start) {
            return when {
                !event.webviewTauglich -> Step(Seite.WebviewVeraltet)
                event.aktiv == null -> Step(Seite.Onboarding)
                else -> Step(Seite.Pruefung(event.aktiv), listOf(Effect.Check(event.aktiv)))
            }
        }
        // Ohne tauglichen WebView ändert nur ein neuer Start etwas (Entwurf D3).
        if (seite is Seite.WebviewVeraltet) return Step(seite)

        return when (event) {
            is Event.Start -> Step(seite)
            is Event.Wechseln -> Step(Seite.Pruefung(event.eintrag), listOf(Effect.Check(event.eintrag)))
            is Event.Verbunden -> loaded(event.eintrag, event.info)
            is Event.Vordergrund -> vordergrund(seite, event)
            Event.ZurOberflaeche -> when (seite) {
                is Seite.Web -> Step(seite, listOf(Effect.HideZurOberflaeche, Effect.Load(seite.eintrag)))
                // Ein neuer Check statt eines Neuladens: erst wenn der Server taugt, geht es weiter.
                is Seite.Status -> Step(Seite.Pruefung(seite.eintrag), listOf(Effect.Check(seite.eintrag)))
                else -> Step(seite)
            }
            is Event.SeiteGeladen -> seiteGeladen(seite, event.url)
            is Event.Ergebnis -> {
                val eintrag = seite.eintrag
                if (eintrag == null || eintrag.id != event.fuer) Step(seite)
                else result(seite, eintrag, event.ergebnis, event.healthVersion)
            }
            Event.Wiederholen -> when {
                seite is Seite.Status && seite.status == Statusseite.NichtErreichbar ->
                    Step(seite, listOf(Effect.Check(seite.eintrag)))
                seite is Seite.Web && seite.offline -> Step(seite, listOf(Effect.Check(seite.eintrag)))
                else -> Step(seite)
            }
            is Event.NavigationFehlgeschlagen -> {
                if (seite !is Seite.Web) return Step(seite)
                // Nur Fehler des Servers selbst; der Identitätsanbieter zeigt seine eigenen.
                if (event.url != null && !Linkregeln.belongsToServer(seite.eintrag.uri, event.url)) {
                    return Step(seite)
                }
                val klasse = klasse(event.fehler) ?: return Step(seite)
                status(seite.eintrag, if (klasse == Fehlerklasse.ZERTIFIKAT) Statusseite.Zertifikat else Statusseite.NichtErreichbar)
            }
            Event.WebProzessBeendet ->
                if (seite is Seite.Web) Step(seite, listOf(Effect.Reload)) else Step(seite)
        }
    }

    /**
     * Bietet die Serverliste „Zur Oberfläche“ an? Nur mit einem Server, dessen Oberfläche geladen
     * ist oder auf einer Status-Seite wartet.
     */
    fun bietetZurOberflaeche(seite: Seite): Boolean = seite is Seite.Web || seite is Seite.Status

    /** Fehlerklasse eines gescheiterten Ladevorgangs; `null` für einen abgebrochenen. */
    private fun klasse(fehler: Netzfehler): Fehlerklasse? = when (fehler) {
        Netzfehler.ZERTIFIKAT -> Fehlerklasse.ZERTIFIKAT
        Netzfehler.VERBINDUNG -> Fehlerklasse.NICHT_ERREICHBAR
        Netzfehler.ABGEBROCHEN -> null
    }

    private fun vordergrund(seite: Seite, event: Event.Vordergrund): Step = when (seite) {
        is Seite.Web ->
            if (event.seiteAntwortet) {
                // Erst prüfen, ob der Server inzwischen einen anderen Vertrag spricht. Eine
                // fremde Seite bleibt stehen (sie kann der Identitätsanbieter sein), aber ohne
                // laufende Anmeldung bietet die App den Weg zurück an.
                val adresse = event.adresse
                if (adresse != null && !event.anmeldungLaeuft && !Linkregeln.belongsToServer(seite.eintrag.uri, adresse)) {
                    Step(seite, listOf(Effect.Check(seite.eintrag), Effect.ShowZurOberflaeche))
                } else {
                    Step(seite, listOf(Effect.Check(seite.eintrag)))
                }
            } else {
                Step(Seite.Pruefung(seite.eintrag), listOf(Effect.Check(seite.eintrag)))
            }
        is Seite.Status -> Step(seite, listOf(Effect.Check(seite.eintrag)))
        else -> Step(seite)
    }

    private fun seiteGeladen(seite: Seite, url: URI?): Step {
        if (seite !is Seite.Web || url == null || !Linkregeln.belongsToServer(seite.eintrag.uri, url)) return Step(seite)
        if (seite.eintrag.geladenImProfil) return Step(seite, listOf(Effect.HideZurOberflaeche))
        // Der Eintrag der Seite zieht mit, damit der nächste Commit nicht noch einmal vermerkt.
        return Step(
            seite.copy(eintrag = seite.eintrag.copy(geladenImProfil = true)),
            listOf(Effect.HideZurOberflaeche, Effect.MarkGeladen(seite.eintrag.id)),
        )
    }

    private fun result(seite: Seite, eintrag: ServerEintrag, ergebnis: Vertragsergebnis, healthVersion: String?): Step {
        val web = seite as? Seite.Web
        return when {
            ergebnis is Vertragsergebnis.Vertraeglich ->
                if (web != null) {
                    // Auch aus der Offline-Oberfläche: neu laden muss die App nicht, das Frontend
                    // verbindet sich selbst (Entwurf D5).
                    Step(
                        Seite.Web(eintrag.verbunden(ergebnis.info), ergebnis.info.shellContract, offline = false),
                        listOf(Effect.MarkVerbunden(eintrag.id, ergebnis.info.shellContract)),
                    )
                } else {
                    loaded(eintrag, ergebnis.info)
                }
            ergebnis is Vertragsergebnis.NichtErreichbar && ergebnis.klasse != Fehlerklasse.ZERTIFIKAT -> when {
                // Die geladene Oberfläche arbeitet ohne Netz weiter (Schreib-Queue, Lagebild aus
                // IndexedDB); eine Status-Seite nähme ihr das. Offline prüft die App weiter.
                web != null -> Step(seite, if (web.offline) listOf(Effect.ScheduleRetry) else emptyList())
                // Ein schon geladener Server startet ohne Netz aus dem Service Worker (Entwurf D5);
                // nur aus der Prüfung, sonst käme nach einem gescheiterten Laden gleich der nächste.
                seite is Seite.Pruefung && eintrag.geladenImProfil && eintrag.bestaetigterVertrag != null ->
                    Step(
                        Seite.Web(eintrag, eintrag.bestaetigterVertrag, offline = true),
                        listOf(Effect.Load(eintrag), Effect.ScheduleRetry),
                    )
                else -> status(eintrag, Statusseite.NichtErreichbar)
            }
            else -> {
                // Ein Zertifikatsfehler heilt nicht von selbst: die Anleitung zum CA-Zertifikat geht vor.
                val status = Statusseite.from(ergebnis, healthVersion) ?: return Step(seite)
                status(eintrag, status)
            }
        }
    }

    private fun loaded(eintrag: ServerEintrag, info: ShellInfo): Step {
        val verbunden = eintrag.verbunden(info)
        return Step(
            Seite.Web(verbunden, info.shellContract),
            listOf(Effect.MarkVerbunden(eintrag.id, info.shellContract), Effect.Load(verbunden)),
        )
    }

    /**
     * Der Eintrag der Seite zieht mit `MarkVerbunden` mit (wie bei `MarkGeladen`): die Prüfung
     * nach einer Rückkehr ohne Netz entscheidet über den Eintrag der Seite, und der muss den
     * bestätigten Vertrag schon in der ersten Sitzung tragen (Entwurf D5, Review W2).
     */
    private fun ServerEintrag.verbunden(info: ShellInfo): ServerEintrag =
        if (bestaetigterVertrag == info.shellContract) this else copy(bestaetigterVertrag = info.shellContract)

    private fun status(eintrag: ServerEintrag, status: Statusseite): Step =
        Step(
            Seite.Status(eintrag, status),
            if (status == Statusseite.NichtErreichbar) listOf(Effect.ScheduleRetry) else emptyList(),
        )

    private val ServerEintrag.uri: URI get() = URI(adresse.text)
}
