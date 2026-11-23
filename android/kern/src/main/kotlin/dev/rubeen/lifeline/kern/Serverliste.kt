package dev.rubeen.lifeline.kern

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Ein gespeicherter Server der Android-App. Die [id] (UUID als Text) benennt auch sein
 * WebView-Profil (Entwurf D3): Cookies, Sitzung und Offline-Daten zweier Server liegen nie im
 * selben Profil.
 */
@Serializable
data class ServerEintrag(
    val id: String,
    val name: String,
    val adresse: ServerAdresse,
    /** Zeitpunkt in Millisekunden seit 1970. */
    val zuletztVerbunden: Long? = null,
    /** Der `shell_contract`, mit dem die App zuletzt geladen hat; ohne Netz gilt er weiter. */
    val bestaetigterVertrag: Int? = null,
    /** Das Profil zeigte diesen Server schon einmal (Entscheidung über Vorab-Wärmen und Wiederherstellen). */
    val geladenImProfil: Boolean = false,
)

enum class ListError {
    UNBEKANNT,

    /** Der aktive Server lässt sich erst nach einem Wechsel entfernen. */
    AKTIV_NICHT_ENTFERNBAR,
}

class ListException(val error: ListError) : Exception(error.name)

/**
 * Die Server der App und welcher davon aktiv ist. Reiner, unveränderlicher Wert: speichern und
 * Profil löschen übernimmt die App. Gelesen wird über [ServerlisteSerializer].
 */
@Serializable(with = ServerlisteSerializer::class)
data class Serverliste(
    val eintraege: List<ServerEintrag> = emptyList(),
    val aktivId: String? = null,
) {
    /** Ein aktiver ohne Eintrag (von Hand verfälschte Datei) gilt als keiner. */
    val aktiv: ServerEintrag?
        get() = aktivId?.let { id -> eintraege.firstOrNull { it.id == id } }

    fun eintragFuer(adresse: ServerAdresse): ServerEintrag? = eintraege.firstOrNull { it.adresse == adresse }

    /**
     * Nimmt einen geprüften Server auf; eine bekannte Adresse gibt ihren Eintrag zurück. Der
     * erste Server wird aktiv, jeder weitere erst über [activate].
     */
    fun add(adresse: ServerAdresse, name: String? = null, neueId: () -> String): Pair<Serverliste, ServerEintrag> {
        eintragFuer(adresse)?.let { return this to it }
        val eintrag = ServerEintrag(id = neueId(), name = name(name, adresse), adresse = adresse)
        val neu = copy(eintraege = eintraege + eintrag)
        return (if (aktiv == null) neu.copy(aktivId = eintrag.id) else neu) to eintrag
    }

    /** Ein leerer Name fällt auf den Hostnamen zurück. */
    fun rename(id: String, name: String): Serverliste =
        change(id) { it.copy(name = name(name, it.adresse)) }

    fun activate(id: String): Serverliste {
        index(id)
        return copy(aktivId = id)
    }

    fun remove(id: String): Serverliste {
        val index = index(id)
        if (id == aktiv?.id) throw ListException(ListError.AKTIV_NICHT_ENTFERNBAR)
        return copy(eintraege = eintraege.filterIndexed { i, _ -> i != index })
    }

    /** Die Oberfläche wurde mit [vertrag] geladen. */
    fun markVerbunden(id: String, zeit: Long, vertrag: Int): Serverliste =
        change(id) { it.copy(zuletztVerbunden = zeit, bestaetigterVertrag = vertrag) }

    /** Das Profil zeigte diesen Server schon. */
    fun markGeladen(id: String): Serverliste = change(id) { it.copy(geladenImProfil = true) }

    private fun change(id: String, aenderung: (ServerEintrag) -> ServerEintrag): Serverliste {
        val index = index(id)
        return copy(eintraege = eintraege.mapIndexed { i, e -> if (i == index) aenderung(e) else e })
    }

    private fun index(id: String): Int {
        val index = eintraege.indexOfFirst { it.id == id }
        if (index < 0) throw ListException(ListError.UNBEKANNT)
        return index
    }

    private fun name(name: String?, adresse: ServerAdresse): String {
        val sauber = name?.trim { it.isWhitespace() } ?: ""
        return sauber.ifEmpty { adresse.host }
    }
}

/** Die Felder der Datei, wie sie gespeichert werden. */
@Serializable
private class ServerlisteDaten(
    val eintraege: List<ServerEintrag> = emptyList(),
    val aktivId: String? = null,
)

/**
 * Liest und schreibt die Serverliste. Ein Eintrag, dessen Adresse die Prüfung heute ablehnt
 * (etwa ein gesperrter Port, LLH-1987), fällt beim Lesen heraus, statt die ganze Liste unlesbar zu
 * machen; wie `Serverliste.swift` und `verbindung::bekannte` der Desktop-Hülle (`0c270c9f`). Jeder
 * andere Fehler bleibt einer, damit `Serverablage.loadOrRecover` die Datei beiseitelegt statt sie
 * still zu kürzen. Fehlt der aktive Server danach, wird der erste übrige aktiv, wie bei `add`.
 */
object ServerlisteSerializer : KSerializer<Serverliste> {
    override val descriptor: SerialDescriptor = ServerlisteDaten.serializer().descriptor

    override fun serialize(encoder: Encoder, value: Serverliste) =
        encoder.encodeSerializableValue(ServerlisteDaten.serializer(), ServerlisteDaten(value.eintraege, value.aktivId))

    override fun deserialize(decoder: Decoder): Serverliste {
        val daten = if (decoder is JsonDecoder) {
            decoder.json.decodeFromJsonElement(ServerlisteDaten.serializer(), ohneAbgelehnte(decoder.decodeJsonElement()))
        } else {
            decoder.decodeSerializableValue(ServerlisteDaten.serializer())
        }
        val aktiv = daten.aktivId
        val aktivFehlt = aktiv != null && daten.eintraege.none { it.id == aktiv }
        return Serverliste(daten.eintraege, if (aktivFehlt) daten.eintraege.firstOrNull()?.id else aktiv)
    }

    /** Nimmt die Einträge heraus, deren `adresse` ein Text ist, den [ServerAdresse.parse] ablehnt. */
    private fun ohneAbgelehnte(element: JsonElement): JsonElement {
        val objekt = element as? JsonObject ?: return element
        val eintraege = objekt["eintraege"] as? JsonArray ?: return element
        val gueltig = eintraege.filterNot { eintrag ->
            val adresse = ((eintrag as? JsonObject)?.get("adresse") as? JsonPrimitive)?.takeIf { it.isString }
            adresse != null && isAbgelehnt(adresse.content)
        }
        return JsonObject(objekt + ("eintraege" to JsonArray(gueltig)))
    }

    private fun isAbgelehnt(adresse: String): Boolean =
        try {
            ServerAdresse.parse(adresse)
            false
        } catch (_: AdressException) {
            true
        }
}
