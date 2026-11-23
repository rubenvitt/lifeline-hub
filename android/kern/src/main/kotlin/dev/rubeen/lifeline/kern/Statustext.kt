package dev.rubeen.lifeline.kern

/**
 * Native Status-Seite der Hülle (Entwurf D2a, D4, D6). Die Seite „kein Server“ ist das
 * Onboarding.
 */
sealed interface Statusseite {
    /** Das System vertraut dem Zertifikat nicht; Anleitung zum CA-Zertifikat. */
    data object Zertifikat : Statusseite

    /** Keine Verbindung; die App prüft weiter und lädt von selbst. */
    data object NichtErreichbar : Statusseite

    /** [Fehlerklasse.ZU_ALT] oder [Fehlerklasse.ZU_NEU] mit der Version des Servers, soweit bekannt. */
    data class NichtVertraeglich(val klasse: Fehlerklasse, val serverVersion: String?) : Statusseite

    /** Der System-WebView ist zu alt für getrennte Profile (Entwurf D3). */
    data object WebviewVeraltet : Statusseite

    companion object {
        /**
         * `null` für einen verträglichen Server. Die Version aus `/api/shell` geht vor der aus
         * `/api/health` (die nur ein Server ohne Vertrag braucht).
         */
        fun from(ergebnis: Vertragsergebnis, healthVersion: String?): Statusseite? = when (ergebnis) {
            is Vertragsergebnis.Vertraeglich -> null
            is Vertragsergebnis.NichtErreichbar ->
                if (ergebnis.klasse == Fehlerklasse.ZERTIFIKAT) Zertifikat else NichtErreichbar
            is Vertragsergebnis.NichtVertraeglich ->
                NichtVertraeglich(ergebnis.klasse, ergebnis.server?.version ?: healthVersion)
        }
    }
}

/** Text einer nativen Status-Seite. */
data class Statustext(
    val titel: String,
    val text: String,
    /** Nummerierte Anleitung (nur „Zertifikat nicht vertrauenswürdig“). */
    val schritte: List<String>,
)

/**
 * [servername] ist der Name aus der Serverliste (ohne Namen steht „Server“), [appVersion] die
 * volle Version der App.
 */
fun Statusseite.text(servername: String?, appVersion: String?): Statustext {
    val name = servername ?: "Server"
    val app = appVersion ?: "unbekannt"
    return when (this) {
        Statusseite.Zertifikat -> Statustext(
            titel = "Zertifikat nicht vertrauenswürdig",
            text = "Dieses Gerät vertraut dem Zertifikat von „$name“ nicht. Ein Server im " +
                "Einsatz-LAN braucht das CA-Zertifikat (mkcert oder eigene CA) auf diesem Gerät.",
            schritte = listOf(
                "CA-Zertifikat auf das Gerät laden.",
                "Unter Einstellungen → Sicherheit → Weitere Sicherheitseinstellungen → Zertifikat " +
                    "installieren → CA-Zertifikat die Datei des Zertifikats auswählen (der " +
                    "Menüpfad heißt je nach Hersteller etwas anders).",
                "Zurück in die App wechseln oder „Erneut prüfen“ tippen.",
            ),
        )
        Statusseite.NichtErreichbar -> Statustext(
            titel = "Server nicht erreichbar",
            text = "„$name“ antwortet nicht. Die App prüft weiter und lädt die Oberfläche, sobald " +
                "der Server wieder antwortet.",
            schritte = emptyList(),
        )
        is Statusseite.NichtVertraeglich ->
            if (klasse == Fehlerklasse.ZU_NEU) {
                Statustext(
                    titel = "App aktualisieren",
                    text = "„$name“ (Version ${serverVersion ?: "unbekannt"}) braucht eine neuere " +
                        "Lifeline-App. Diese App hat Version $app. Bitte die App aktualisieren.",
                    schritte = emptyList(),
                )
            } else {
                Statustext(
                    titel = "Server ist zu alt für diese App",
                    text = "„$name“ (Version ${serverVersion ?: "unbekannt"}) ist zu alt für diese " +
                        "App (Version $app). Der Server muss aktualisiert werden.",
                    schritte = emptyList(),
                )
            }
        Statusseite.WebviewVeraltet -> Statustext(
            titel = "System-WebView aktualisieren",
            text = "Diese App braucht einen aktuellen System-WebView, damit jeder Server seine " +
                "eigenen Daten hat. Bitte „Android System WebView“ über Google Play aktualisieren.",
            schritte = emptyList(),
        )
    }
}
