package dev.rubeen.lifeline.kern

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json

/** Ablage der Serverliste als JSON (`<verzeichnis>/server.json`). */
class Serverablage(val verzeichnis: File) {
    private val datei: File get() = File(verzeichnis, "server.json")
    private val beiseite: File get() = File(verzeichnis, "server.defekt.json")

    @OptIn(ExperimentalSerializationApi::class)
    private val json = Json {
        prettyPrint = true
        encodeDefaults = true
    }

    /** Ohne Datei eine leere Liste; eine unlesbare Datei wirft. */
    fun load(): Serverliste {
        if (!datei.exists()) return Serverliste()
        return json.decodeFromString(Serverliste.serializer(), datei.readText(Charsets.UTF_8))
    }

    /** Schreibt über eine Hilfsdatei und benennt um, damit nie eine halbe Datei bleibt. */
    fun save(liste: Serverliste) {
        verzeichnis.mkdirs()
        val hilfe = File(verzeichnis, "server.json.tmp")
        hilfe.writeText(json.encodeToString(Serverliste.serializer(), liste), Charsets.UTF_8)
        try {
            Files.move(hilfe.toPath(), datei.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
            Files.move(hilfe.toPath(), datei.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    /**
     * Wie [load], aber eine unlesbare Datei wird als `server.defekt.json` beiseitegelegt statt
     * beim nächsten Speichern überschrieben; dann beginnt die App mit einer leeren Liste.
     */
    fun loadOrRecover(): Serverliste =
        try {
            load()
        } catch (_: Exception) {
            beiseite.delete()
            datei.renameTo(beiseite)
            Serverliste()
        }
}
