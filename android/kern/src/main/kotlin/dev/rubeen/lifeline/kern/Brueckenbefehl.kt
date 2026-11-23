package dev.rubeen.lifeline.kern

import java.util.Base64
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Ein Befehl der Seite an die Hülle. Die Wire-Namen sind englisch und fest. */
sealed interface Brueckenbefehl {
    /** Feuern und vergessen, ohne Antwort; [kind] ist ungeprüft ([Haptik.feedback]). */
    data class Haptics(val kind: String) : Brueckenbefehl

    data class ShowNotification(val id: Int, val title: String, val body: String?) : Brueckenbefehl

    data class Print(val id: Int) : Brueckenbefehl

    data class SignInWithBrowser(val id: Int) : Brueckenbefehl

    /** Ein `blob:`-Download der Seite; [base64] ist der Inhalt, [name] der Vorschlag der Seite. */
    data class DownloadBlob(val id: Int, val name: String, val base64: String) : Brueckenbefehl

    /** Unbekannter Befehl oder fehlerhafte Felder; die Seite bekommt eine Ablehnung. */
    data class Ungueltig(val id: Int, val grund: String) : Brueckenbefehl
}

/** Wert einer erfüllten Antwort; mehr braucht die Brücke nicht. */
sealed interface Antwortwert {
    data object Null : Antwortwert

    data class Bool(val wert: Boolean) : Antwortwert
}

/** Antwort an die Seite; [fehler] `null` erfüllt das Versprechen der Seite, sonst lehnt es ab. */
data class Brueckenantwort(val id: Int, val fehler: String?, val wert: Antwortwert)

/** Ob die Person Meldungen der App erlaubt hat (`POST_NOTIFICATIONS`). */
enum class Meldungsfreigabe {
    /** Noch nie gefragt: der erste Aufruf fragt. */
    OFFEN,
    ERLAUBT,
    VERWEIGERT,
}

/** Die Systemdienste, die die Brücke braucht; die App setzt sie um, die Tests mit einer Attrappe. */
interface Huellendienste {
    /** Schalter „Haptik“ in den Einstellungen der Hülle (Vorgabe an). */
    val isHaptikEnabled: Boolean

    fun play(feedback: Haptik.Feedback)

    suspend fun loadMeldungsfreigabe(): Meldungsfreigabe

    /** Fragt die Person; `true`, wenn sie Meldungen erlaubt. */
    suspend fun requestMeldungsfreigabe(): Boolean

    suspend fun showNotification(title: String, body: String?)

    /** Öffnet den Druckdialog; `true`, wenn gedruckt wurde. */
    suspend fun print(): Boolean

    /** Startet „Im Browser anmelden“ (Entwurf D7); wirft, wenn die Sitzung nicht beginnt. */
    fun startAnmeldung()

    /** Legt einen `blob:`-Download ab und bietet ihn zum Teilen an (Entwurf D8). */
    suspend fun saveDownload(name: String, bytes: ByteArray)
}

/** Führt einen angenommenen Befehl aus. */
object Brueckenausfuehrung {
    const val MELDUNGEN_AUS =
        "Meldungen sind für Lifeline ausgeschaltet (Einstellungen → Apps → Lifeline → Benachrichtigungen)."

    /** `null` für `haptics` (ohne Antwort), sonst die Antwort an die Seite. */
    suspend fun run(befehl: Brueckenbefehl, dienste: Huellendienste): Brueckenantwort? = when (befehl) {
        is Brueckenbefehl.Haptics -> {
            Haptik.feedback(befehl.kind, dienste.isHaptikEnabled)?.let(dienste::play)
            null
        }
        is Brueckenbefehl.ShowNotification -> antwort(befehl.id) {
            if (!isMeldungErlaubt(dienste)) throw IllegalStateException(MELDUNGEN_AUS)
            dienste.showNotification(befehl.title, befehl.body)
            Antwortwert.Null
        }
        is Brueckenbefehl.Print -> antwort(befehl.id) { Antwortwert.Bool(dienste.print()) }
        is Brueckenbefehl.SignInWithBrowser -> antwort(befehl.id) {
            dienste.startAnmeldung()
            Antwortwert.Null
        }
        is Brueckenbefehl.DownloadBlob -> antwort(befehl.id) {
            // Bis zu 50 MB: nicht im Hauptfaden der App entschlüsseln (Review W6).
            val bytes = withContext(Dispatchers.Default) {
                try {
                    Base64.getDecoder().decode(befehl.base64)
                } catch (_: IllegalArgumentException) {
                    throw IllegalStateException("Der Download ist nicht lesbar.")
                }
            }
            dienste.saveDownload(befehl.name, bytes)
            Antwortwert.Null
        }
        is Brueckenbefehl.Ungueltig -> Brueckenantwort(befehl.id, befehl.grund, Antwortwert.Null)
    }

    /** Berechtigung beim ersten Aufruf: nur wer noch nie gefragt wurde, wird gefragt. */
    private suspend fun isMeldungErlaubt(dienste: Huellendienste): Boolean =
        when (dienste.loadMeldungsfreigabe()) {
            Meldungsfreigabe.ERLAUBT -> true
            Meldungsfreigabe.VERWEIGERT -> false
            Meldungsfreigabe.OFFEN -> dienste.requestMeldungsfreigabe()
        }

    private suspend fun antwort(id: Int, arbeit: suspend () -> Antwortwert): Brueckenantwort =
        try {
            Brueckenantwort(id, null, arbeit())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Brueckenantwort(id, e.message ?: e.toString(), Antwortwert.Null)
        }
}
