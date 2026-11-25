package dev.rubeen.lifeline.helferkern

import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

// Wire-Typen der Helfer-Routen (src/helfer/anmeldung.rs, src/routes/helfer.rs; generiert in
// frontend/src/api/types.generated.ts). Die Felder tragen die englischen Wire-Namen; gleich wie
// `ios/Helfer/App/Dienste/Wire.swift`.

/** Ein wählbares Ziel vor dem Einlösen (`HelferZielOption`). */
@Serializable
data class ZielOption(
    /** `unit` oder `vehicle`. */
    val kind: String,
    val id: Long,
    /** Name der Einheit bzw. Funkrufname des Fahrzeugs. */
    val name: String,
    @SerialName("call_sign") val callSign: String? = null,
    @SerialName("sign_function") val signFunction: String? = null,
    @SerialName("sign_organization") val signOrganization: String? = null,
) {
    /** Eindeutig über Art und Kennung (Einheit und Fahrzeug können dieselbe Zahl tragen). */
    val kennung: String get() = "$kind-$id"
    val isFahrzeug: Boolean get() = kind == "vehicle"
    val eingabe: ZielEingabe get() = ZielEingabe(kind, id)
    val zeichen: String? get() = Anzeige.zeichen(signOrganization, signFunction)
}

/** Antwort von `POST /api/devices/helpers/targets` (`HelferZielliste`). */
@Serializable
data class Zielliste(
    val targets: List<ZielOption>,
    @SerialName("person_tracking_allowed") val personTrackingAllowed: Boolean,
)

/** Ziel, wie die App es beim Einlösen und Ändern schickt (`ZielEingabe`). */
@Serializable
data class ZielEingabe(val kind: String, val id: Long)

/** Body von `POST /api/devices/helpers/redeem`. */
@Serializable
data class Einloesung(
    val code: String,
    @SerialName("display_name") val displayName: String,
    val target: ZielEingabe,
    @SerialName("track_person") val trackPerson: Boolean,
)

/**
 * Body von `POST /api/devices/helpers/targets`: der Code steht im Body, nie in der Adresse, damit
 * er in keinem Zugriffsprotokoll landet (wie `/koppeln` und das Einlösen).
 */
@Serializable
private data class Zielanfrage(val code: String)

@Serializable
private data class Zielaenderung(val target: ZielEingabe)

@Serializable
private data class Pausensendung(val paused: Boolean)

@Serializable
private data class Positionssendung(
    val lat: Double,
    val lon: Double,
    @SerialName("accuracy_m") val accuracyM: Double? = null,
    @SerialName("recorded_at") val recordedAt: String,
)

/** Eigener Zustand der Kopplung (`HelferZustand`, `GET /api/devices/me` und Antwort auf das Einlösen). */
@Serializable
data class Zustand(
    /** `unbestaetigt`, `aktiv`, `abgelehnt` oder `beendet`. */
    val state: String,
    /** `HelferEndeGrund` als Wire-Wert ([Grund.ausWire]). */
    val reason: String? = null,
    val incident: Einsatz,
    val target: Ziel? = null,
    val person: Person? = null,
    @SerialName("is_tracker") val isTracker: Boolean,
    val paused: Boolean,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("server_time") val serverTime: String,
) {
    @Serializable
    data class Einsatz(val id: Long, val name: String)

    @Serializable
    data class Ziel(val kind: String, val id: Long, val name: String)

    @Serializable
    data class Person(val id: Long, val name: String)

    /** Was die Leitung beim Bestätigen gegeben hat ([Ereignis.Zustand]). */
    val rolle: Rolle
        get() = Rolle(isTracker, person?.id)

    /** Ablauf der Kopplung auf der Uhr des Geräts (der Server nennt seine Uhrzeit mit); `null`, wenn unlesbar. */
    fun ablauf(jetzt: Instant): Instant? {
        val ablauf = Wire.serverzeit(expiresAt) ?: return null
        val server = Wire.serverzeit(serverTime) ?: return null
        return jetzt.plus(Duration.between(server, ablauf))
    }
}

/** Fehler-Body `{error, reason?}`; beide `null`, wenn der Body keiner ist. */
@Serializable
data class Fehler(val error: String? = null, val reason: String? = null)

/** Lesen und Schreiben der Wire-Bodies. Lesen gibt `null` für einen Body, der nicht passt. */
object Wire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val serverformat: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

    fun zustand(text: String): Zustand? = lies { json.decodeFromString<Zustand>(text) }

    fun zielliste(text: String): Zielliste? = lies { json.decodeFromString<Zielliste>(text) }

    fun fehler(text: String): Fehler = lies { json.decodeFromString<Fehler>(text) } ?: Fehler()

    fun zielanfrage(code: String): String = json.encodeToString(Zielanfrage(code))

    fun einloesung(e: Einloesung): String = json.encodeToString(e)

    fun zielaenderung(ziel: ZielEingabe): String = json.encodeToString(Zielaenderung(ziel))

    fun pause(paused: Boolean): String = json.encodeToString(Pausensendung(paused))

    /** `recorded_at` nach RFC 3339 in UTC. */
    fun position(p: Position): String =
        json.encodeToString(Positionssendung(p.latitude, p.longitude, p.accuracy, p.recordedAt.toString()))

    /** Zeitpunkte des Servers (`expires_at`, `server_time`): UTC, `yyyy-MM-dd HH:mm:ss`. */
    fun serverzeit(text: String): Instant? =
        try {
            LocalDateTime.parse(text, serverformat).toInstant(ZoneOffset.UTC)
        } catch (_: DateTimeParseException) {
            null
        }

    private inline fun <T> lies(block: () -> T): T? =
        try {
            block()
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
}
