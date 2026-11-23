package dev.rubeen.lifeline.kern

import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * PKCE (RFC 7636, S256) für „Im Browser anmelden“ (wie `src-tauri/src/pkce.rs`): Der `verifier`
 * bleibt in der App, nur die `challenge` geht an den Browser.
 */
object PKCE {
    private val zufall = SecureRandom()

    /** Neuer `verifier`: 32 Byte aus `SecureRandom`, base64url ohne Auffüllung, 43 Zeichen. */
    fun neuerVerifier(): String = base64url(ByteArray(32).also(zufall::nextBytes))

    /** `base64url(SHA-256(verifier))` ohne Auffüllung, 43 Zeichen. */
    fun challenge(verifier: String): String =
        base64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)))

    private fun base64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

/**
 * Reine Schritte rund um die Anmeldesitzung (wie `src-tauri/src/anmeldung.rs` und
 * `Anmeldung.swift`; Entwurf D7). Den Code löst die Seite des Servers im WebView ein, weil nur
 * dort der Datenspeicher liegt, in dem die Sitzung entstehen muss.
 */
object Anmeldung {
    /** Pfad der Anmeldeseite, auf der die App einlöst. */
    const val ANMELDESEITE = "/login"

    /** Pfad der Bestätigungsseite im Browser (`frontend/src/pages/AppAnmeldungPage.tsx`). */
    const val BESTAETIGUNG = "/app-anmeldung"

    /** Ereignis, mit dem die App der Seite das Ergebnis meldet; es trägt nie Code oder `verifier`. */
    const val EREIGNIS = "lifeline:app-anmeldung"

    /** Host des Rücksprungs `lifeline://anmeldung?code=…`. */
    const val RUECKSPRUNG_HOST = "anmeldung"

    /** Kennwörter von `AppAnmeldungErgebnis` in `frontend/src/huelle/faehigkeiten.ts`. */
    enum class Ergebnis(val kennwort: String) {
        ANGEMELDET("angemeldet"),
        ABGELEHNT("abgelehnt"),
        FEHLER("fehler"),
        ABGEBROCHEN("abgebrochen"),
    }

    /** Wie die Sitzung endete. */
    sealed interface Ende {
        /** Rücksprung-URL aus der Sitzung (nur die Sitzung liefert ihn, nie ein Intent von außen). */
        data class Ruecksprung(val url: String) : Ende

        /** Die Person hat abgebrochen. */
        data object Abgebrochen : Ende

        data object Fehler : Ende
    }

    sealed interface Folge {
        /** Den Code im WebView einlösen. */
        data class Einloesen(val code: String) : Folge

        /** Nur ein Ergebnis melden, ohne Geheimnis. */
        data class Melden(val ergebnis: Ergebnis) : Folge

        /**
         * Nichts tun: der WebView zeigt keine Seite des Servers (bzw. beim Einlösen nicht die
         * Anmeldeseite), Code und `verifier` bleiben draußen.
         */
        data object Nichts : Folge
    }

    /** Bestätigungsseite auf der Origin des Servers mit der `challenge`. */
    fun bestaetigungUrl(server: ServerAdresse, challenge: String): URI {
        val port = server.port?.let { ":$it" } ?: ""
        val wert = URLEncoder.encode(challenge, Charsets.UTF_8)
        return URI("https://${server.host}$port$BESTAETIGUNG?challenge=$wert")
    }

    /** Code aus `lifeline://anmeldung?code=<64 hex klein>`; alles andere `null`. */
    fun code(ausRuecksprung: String): String? {
        val uri = try {
            URI(ausRuecksprung)
        } catch (_: Exception) {
            return null
        }
        if (uri.scheme?.lowercase() != Deeplink.SCHEMA || uri.rawAuthority != RUECKSPRUNG_HOST) return null
        if (uri.rawPath != "" && uri.rawPath != "/") return null
        val code = uri.rawQuery?.split('&')
            ?.firstOrNull { it.substringBefore('=') == "code" && '=' in it }
            ?.substringAfter('=') ?: return null
        val hexKlein = code.all { it in '0'..'9' || it in 'a'..'f' }
        return code.takeIf { it.length == 64 && hexKlein }
    }

    /**
     * Entscheidet über das Ende der Sitzung. [seite] ist die aktuelle Adresse des WebViews, in dem
     * die Anmeldung begann (`null`, wenn es ihn nicht mehr gibt).
     */
    fun folge(ende: Ende, seite: URI?, server: ServerAdresse): Folge {
        if (seite == null || !Linkregeln.belongsToServer(URI(server.text), seite)) return Folge.Nichts
        val ruecksprung = when (ende) {
            Ende.Abgebrochen -> return Folge.Melden(Ergebnis.ABGEBROCHEN)
            Ende.Fehler -> return Folge.Melden(Ergebnis.FEHLER)
            is Ende.Ruecksprung -> ende.url
        }
        val code = code(ruecksprung) ?: return Folge.Melden(Ergebnis.FEHLER)
        // Nur dort hört die Seite auf das Ergebnis; wer inzwischen anders angemeldet
        // weiterarbeitet, verliert seine Sitzung nicht an einen späten Rücksprung.
        return if (seite.path == ANMELDESEITE) Folge.Einloesen(code) else Folge.Nichts
    }

    /**
     * Skript, das den Code im WebView einlöst und das Ergebnis als [EREIGNIS] meldet. Die Origin
     * prüft es noch einmal, weil die Seite zwischen Prüfung und Ausführung wechseln kann. Endet
     * auf `0`, weil `evaluateJavascript` bei einem Promise sonst kein brauchbares Ergebnis liefert.
     */
    fun einloeseSkript(server: ServerAdresse, code: String, verifier: String): String {
        val origin = jsLiteral(Bruecke.allowedOriginRule(server))
        val codeLiteral = jsLiteral(code)
        val verifierLiteral = jsLiteral(verifier)
        val ereignis = jsLiteral(EREIGNIS)
        return "(() => { const melden = (ergebnis) => window.dispatchEvent(new CustomEvent($ereignis, " +
            "{ detail: { ergebnis } })); if (window.location.origin !== $origin) return; " +
            "fetch('/api/auth/app-code/einloesen', { method: 'POST', credentials: 'same-origin', " +
            "headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $codeLiteral, " +
            "verifier: $verifierLiteral }) }).then((antwort) => melden(antwort.ok ? 'angemeldet' : " +
            "antwort.status === 401 ? 'abgelehnt' : 'fehler')).catch(() => melden('fehler')); })(); 0;"
    }

    /** Skript, das nur ein Ergebnis meldet (Abbruch, Fehler vor dem Einlösen). */
    fun meldungSkript(ergebnis: Ergebnis): String =
        "window.dispatchEvent(new CustomEvent(${jsLiteral(EREIGNIS)}, { detail: { ergebnis: " +
            "${jsLiteral(ergebnis.kennwort)} } })); 0;"
}

/**
 * Die laufende Anmeldesitzung mit ihrer Generation (wie `anmeldung::Lauf` der Desktop-Hülle).
 * Der Handler einer ersetzten Sitzung kann nach dem Start der neuen eintreffen und darf diese
 * nicht beenden.
 */
class Anmeldelauf<W : Any> {
    private var generation = 0L
    private var laufend: Pair<Long, W>? = null

    /** Läuft gerade eine Sitzung (gemerkt und noch nicht beendet)? */
    val isLaufend: Boolean get() = laufend != null

    /** Nächste Generation, bevor die Sitzung gebaut wird (ihr Handler braucht sie). */
    fun naechste(): Long = ++generation

    fun merke(generation: Long, wert: W) {
        laufend = generation to wert
    }

    /** Nimmt die laufende Sitzung heraus, gleich welcher Generation (zum Abbrechen). */
    fun nimm(): W? {
        val wert = laufend?.second
        laufend = null
        return wert
    }

    /** Nimmt die Sitzung nur heraus, wenn sie zu [generation] gehört. */
    fun beende(generation: Long): W? = if (laufend?.first == generation) nimm() else null
}
