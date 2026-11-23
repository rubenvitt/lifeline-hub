package dev.rubeen.lifeline.kern

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * Warum eine eingegebene Serveradresse nicht taugt. Die Kennwörter sind die der gemeinsamen
 * Fälle (`src-tauri/faelle/adresse.json`), die Meldungen gleichen denen der Desktop-Hülle
 * (`src-tauri/src/adresse.rs`, `AdressFehler`) Wort für Wort.
 */
enum class AdressError(val kennwort: String) {
    LEER("leer"),
    UNLESBAR("unlesbar"),
    KEIN_HTTPS("kein_https"),
    OHNE_HOST("ohne_host"),
    MIT_ZUGANGSDATEN("mit_zugangsdaten"),
    GESPERRTER_PORT("gesperrter_port");

    val meldung: String
        get() = when (this) {
            LEER -> "Bitte die Adresse des Einsatzservers eingeben."
            UNLESBAR -> "Das ist keine gültige Adresse. Beispiel: https://elw.local:8443"
            KEIN_HTTPS ->
                "Nur https-Adressen sind möglich: Offline-Betrieb und Passkey brauchen eine gesicherte Verbindung."
            OHNE_HOST -> "Der Adresse fehlt der Hostname, z. B. elw.local."
            MIT_ZUGANGSDATEN -> "Die Adresse darf keinen Namen und kein Passwort vor „@“ enthalten."
            GESPERRTER_PORT ->
                "Diesen Port sperrt der Webview. Bitte den Server auf einem anderen Port betreiben, z. B. 8443."
        }
}

/** Wirft [ServerAdresse.parse] bei einer Eingabe, die nicht taugt. */
class AdressException(val error: AdressError) : Exception(error.meldung)

/**
 * Eine geprüfte https-Adresse eines Servers in der Form, die auch die Desktop-Hülle vergleicht
 * (WHATWG-URL wie das Rust-Crate `url`): Schema und Host klein, Standardport weggelassen, Pfad
 * mindestens `/`. Zwei Adressen sind gleich, wenn ihr [text] gleich ist.
 */
@Serializable(with = ServerAdresseSerializer::class)
@ConsistentCopyVisibility
data class ServerAdresse private constructor(val text: String, val host: String) {
    /** Der ausdrückliche Port; `null`, wenn die Adresse den Standardport 443 meint. */
    val port: Int?
        get() {
            val autoritaet = text.removePrefix("https://").takeWhile { it != '/' && it != '?' && it != '#' }
            val rest = autoritaet.substringAfterLast(']', autoritaet)
            return if (':' in rest) rest.substringAfterLast(':').toInt() else null
        }

    override fun toString(): String = text

    companion object {
        /** Schemata, bei denen der URL-Standard einen Host verlangt (wie in `adresse.rs`). */
        private val schemataMitHost = setOf("http", "https", "ws", "wss", "ftp")
        private val schemaRegel = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")
        private val ungueltigImHost = Regex("[\\s<>^|\\\\%\\u0000-\\u001f]")

        /**
         * Ports, auf die der Webview nicht navigiert (die „bad ports“ der Fetch-Spezifikation und
         * Port 0); die Seite bliebe leer (LLH-1987). Dieselbe Liste wie `GESPERRTE_PORTS` in
         * `src-tauri/src/adresse.rs` und `ServerAdresse.gesperrtePorts` im iOS-Kern; der Test
         * prüft sie gegen `gesperrte_ports` der gemeinsamen Fälle.
         */
        val GESPERRTE_PORTS: Set<Int> = setOf(
            0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101,
            102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389,
            427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
            989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
            6666, 6667, 6668, 6669, 6679, 6697, 10080,
        )

        /**
         * Prüft eine eingegebene Adresse Regel für Regel wie `pruefe_adresse` der Desktop-Hülle.
         * Leerraum an den Rändern zählt nicht.
         */
        fun parse(eingabe: String): ServerAdresse {
            val roh = eingabe.trim { it.isWhitespace() }
            if (roh.isEmpty()) throw AdressException(AdressError.LEER)
            val treffer = schemaRegel.find(roh) ?: throw AdressException(AdressError.UNLESBAR)
            val schema = treffer.groupValues[1].lowercase()
            val nachSchema = roh.substring(treffer.value.length)

            // Wer drei Schrägstriche tippt, hat den Hostnamen vergessen; der URL-Standard machte
            // aus `https:///einsatz` still den Host `einsatz`.
            val dreiSchraegstriche = nachSchema.startsWith("///")
            val hatAutoritaet = nachSchema.startsWith("//")
            val nachAutoritaetszeichen = if (hatAutoritaet) nachSchema.substring(2) else ""
            val ende = nachAutoritaetszeichen.indexOfFirst { it == '/' || it == '?' || it == '#' }
            val autoritaet =
                if (!hatAutoritaet) "" else if (ende < 0) nachAutoritaetszeichen else nachAutoritaetszeichen.substring(0, ende)
            val rest =
                if (!hatAutoritaet) nachSchema else if (ende < 0) "" else nachAutoritaetszeichen.substring(ende)

            val klammerAt = autoritaet.lastIndexOf('@')
            val zugang = if (klammerAt >= 0) autoritaet.substring(0, klammerAt) else null
            val hostPort = if (klammerAt >= 0) autoritaet.substring(klammerAt + 1) else autoritaet

            // Host und Port trennen; eckige Klammern halten IPv6-Adressen zusammen.
            val portTrenner = hostPort.lastIndexOf(':')
            val hostRoh: String
            val portText: String?
            if (portTrenner >= 0 && portTrenner > hostPort.lastIndexOf(']')) {
                hostRoh = hostPort.substring(0, portTrenner)
                portText = hostPort.substring(portTrenner + 1)
            } else {
                hostRoh = hostPort
                portText = null
            }
            val host = hostRoh.lowercase()

            if (schema in schemataMitHost && host.isEmpty() && !dreiSchraegstriche) {
                throw AdressException(AdressError.OHNE_HOST)
            }
            if (schema != "https") throw AdressException(AdressError.KEIN_HTTPS)
            if (dreiSchraegstriche || host.isEmpty()) throw AdressException(AdressError.OHNE_HOST)
            // `https://elw.local:8443@evil.example` hat den Host `evil.example`; im
            // Bestätigungsdialog läse sich der vorn stehende Name wie der vertraute Server.
            if (zugang != null && zugang.isNotEmpty()) throw AdressException(AdressError.MIT_ZUGANGSDATEN)
            if (ungueltigImHost.containsMatchIn(host)) throw AdressException(AdressError.UNLESBAR)

            var port: Int? = null
            if (portText != null && portText.isNotEmpty()) {
                if (!portText.all { it in '0'..'9' }) throw AdressException(AdressError.UNLESBAR)
                val zahl = portText.toIntOrNull() ?: throw AdressException(AdressError.UNLESBAR)
                if (zahl > 65535) throw AdressException(AdressError.UNLESBAR)
                port = zahl
            }
            if (port != null && port != 443 && port in GESPERRTE_PORTS) {
                throw AdressException(AdressError.GESPERRTER_PORT)
            }

            val fragmentAt = rest.indexOf('#')
            val vorFragment = if (fragmentAt >= 0) rest.substring(0, fragmentAt) else rest
            val fragment = if (fragmentAt >= 0) rest.substring(fragmentAt + 1) else null
            val queryAt = vorFragment.indexOf('?')
            val pfad = if (queryAt >= 0) vorFragment.substring(0, queryAt) else vorFragment
            val query = if (queryAt >= 0) vorFragment.substring(queryAt + 1) else null

            val text = buildString {
                append("https://").append(host)
                if (port != null && port != 443) append(':').append(port)
                append(pfad.ifEmpty { "/" })
                if (query != null) append('?').append(query)
                if (fragment != null) append('#').append(fragment)
            }
            return ServerAdresse(text, host)
        }
    }
}

/** Als einfacher Text gespeichert; beim Lesen gilt dieselbe Prüfung wie bei der Eingabe. */
object ServerAdresseSerializer : KSerializer<ServerAdresse> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("dev.rubeen.lifeline.kern.ServerAdresse", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: ServerAdresse) = encoder.encodeString(value.text)

    override fun deserialize(decoder: Decoder): ServerAdresse =
        try {
            ServerAdresse.parse(decoder.decodeString())
        } catch (e: AdressException) {
            throw SerializationException(e.error.meldung, e)
        }
}
