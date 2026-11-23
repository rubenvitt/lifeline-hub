package dev.rubeen.lifeline.kern

import java.net.URI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private val lenient = Json { ignoreUnknownKeys = true }

/**
 * Antwort von `GET /api/shell` (OpenAPI-Schema `ShellInfo`, Spec `huellen-vertrag`). Neue Felder
 * des Servers ignoriert die App; die Namen auf dem Draht sind fest.
 */
@Serializable
data class ShellInfo(
    val version: String,
    @SerialName("shell_contract") val shellContract: Int,
)

/** Die Version aus `GET /api/health`, für die Seite „Server ist zu alt für diese App“. */
fun healthVersion(json: String): String? =
    try {
        lenient.parseToJsonElement(json).jsonObject["version"]?.jsonPrimitive?.contentOrNull
    } catch (_: Exception) {
        null
    }

/**
 * Die Art eines Netzfehlers beim Abruf oder Laden. Die App ordnet Ausnahmen und WebView-
 * Fehlercodes zu (`SSLException` und `ERROR_FAILED_SSL_HANDSHAKE` → [ZERTIFIKAT], Abbruch durch
 * die App selbst → [ABGEBROCHEN], alles andere → [VERBINDUNG]).
 */
enum class Netzfehler {
    /** Das System vertraut dem Zertifikat des Servers nicht. */
    ZERTIFIKAT,

    /** Keine Verbindung, Zeitüberschreitung, Namensauflösung. */
    VERBINDUNG,

    /** Die App hat den Abruf selbst beendet; das ist kein Fehler der Seite (wie `cancelled`). */
    ABGEBROCHEN,
}

/**
 * Warum die App die Oberfläche eines Servers nicht lädt; je Klasse eine native Seite
 * (Entwurf D2a, D4).
 */
enum class Fehlerklasse {
    /** Das System vertraut dem Zertifikat nicht (CA-Zertifikat fehlt). */
    ZERTIFIKAT,

    /** Keine Verbindung; die App prüft weiter und lädt von selbst. */
    NICHT_ERREICHBAR,

    /** Der Server kennt den Vertrag nicht oder spricht einen kleineren: „Server ist zu alt“. */
    ZU_ALT,

    /** Der Server spricht einen größeren Vertrag: „App aktualisieren“. */
    ZU_NEU,
}

/** Was die App beim Abruf von `GET /api/shell` erlebt hat. */
sealed interface ShellAbruf {
    /**
     * [contentType] ist der Kopf `Content-Type`, wie er kam (`null`, wenn er fehlt). Eine
     * Weiterleitung auf eine fremde Origin verfolgt der Abruf nicht; sie kommt als 3xx an.
     */
    data class Antwort(val status: Int, val body: String, val contentType: String?) : ShellAbruf

    data class Fehler(val netzfehler: Netzfehler) : ShellAbruf

    companion object {
        /** Medientyp `application/json`, gleich mit welchen Parametern (`charset`). */
        fun isJson(contentType: String?): Boolean {
            val medientyp = contentType?.substringBefore(';') ?: return false
            return medientyp.trim { it.isWhitespace() }.lowercase() == "application/json"
        }
    }
}

sealed interface Vertragsergebnis {
    /** Die App lädt die Oberfläche. */
    data class Vertraeglich(val info: ShellInfo) : Vertragsergebnis

    /**
     * [Fehlerklasse.ZU_ALT] oder [Fehlerklasse.ZU_NEU]; [server] fehlt, wenn der Server keinen
     * Vertrag nannte oder nur der zuletzt bestätigte galt.
     */
    data class NichtVertraeglich(val klasse: Fehlerklasse, val server: ShellInfo?) : Vertragsergebnis

    /** [Fehlerklasse.ZERTIFIKAT] oder [Fehlerklasse.NICHT_ERREICHBAR]. */
    data class NichtErreichbar(val klasse: Fehlerklasse) : Vertragsergebnis

    val fehlerklasse: Fehlerklasse?
        get() = when (this) {
            is Vertraeglich -> null
            is NichtVertraeglich -> klasse
            is NichtErreichbar -> klasse
        }
}

/**
 * Prüft, ob die App mit einem Server arbeiten kann (Entwurf D4): bei jedem Start, Wechsel,
 * Neuladen nach Rückkehr in den Vordergrund und im Onboarding.
 */
object Vertragspruefung {
    fun evaluate(
        abruf: ShellAbruf,
        letzterVertrag: Int?,
        bekannt: List<Int> = LifelineKern.bekannteVertraege,
    ): Vertragsergebnis = when (abruf) {
        is ShellAbruf.Antwort -> when {
            abruf.status == 200 && ShellAbruf.isJson(abruf.contentType) -> {
                // JSON ohne lesbaren Vertrag ist ein Server ohne Vertrag, also zu alt.
                val info = try {
                    lenient.decodeFromString(ShellInfo.serializer(), abruf.body)
                } catch (_: Exception) {
                    null
                }
                when {
                    info == null -> Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null)
                    else -> richtung(info.shellContract, bekannt)
                        ?.let { Vertragsergebnis.NichtVertraeglich(it, info) }
                        ?: Vertragsergebnis.Vertraeglich(info)
                }
            }
            // Vom Server selbst: eine fremde Origin hat der Abruf nicht erreicht.
            abruf.status == 404 -> Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null)
            // Ein Proxy, ein startender Server, eine Weiterleitung oder ein Captive Portal mit
            // einer 200 ohne JSON: das ist nicht der Server, also wie ohne Verbindung.
            else -> ohneVerbindung(Fehlerklasse.NICHT_ERREICHBAR, letzterVertrag, bekannt)
        }
        is ShellAbruf.Fehler ->
            if (abruf.netzfehler == Netzfehler.ZERTIFIKAT) {
                Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT)
            } else {
                ohneVerbindung(Fehlerklasse.NICHT_ERREICHBAR, letzterVertrag, bekannt)
            }
    }

    /**
     * Folgt der Abruf einer Weiterleitung? Nur auf derselben Origin; eine fremde (Captive Portal,
     * Auth-Proxy) beantwortet nicht der Server, ihre 3xx gilt wie ohne Verbindung.
     */
    fun followsRedirect(von: URI?, nach: URI?): Boolean {
        if (von == null || nach == null) return false
        return Linkregeln.isEigeneOrigin(von, nach)
    }

    /** Richtung eines unbekannten Vertrags; `null`, wenn die App ihn kennt. */
    fun richtung(vertrag: Int, bekannt: List<Int>): Fehlerklasse? {
        if (vertrag in bekannt) return null
        return if (vertrag > (bekannt.maxOrNull() ?: 0)) Fehlerklasse.ZU_NEU else Fehlerklasse.ZU_ALT
    }

    /** Ohne Verbindung gilt der zuletzt bestätigte Vertrag dieses Servers. */
    private fun ohneVerbindung(klasse: Fehlerklasse, letzterVertrag: Int?, bekannt: List<Int>): Vertragsergebnis {
        val richtung = letzterVertrag?.let { richtung(it, bekannt) }
        return if (richtung != null) {
            Vertragsergebnis.NichtVertraeglich(richtung, null)
        } else {
            Vertragsergebnis.NichtErreichbar(klasse)
        }
    }
}
