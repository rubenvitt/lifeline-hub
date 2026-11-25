package dev.rubeen.lifeline.helferkern

import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/**
 * Liest die gemeinsamen Fälle (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“) wie
 * `android/kern/…/GemeinsameFaelle.kt`: eine Quelle, keine Kopie; die Suite sucht ab dem
 * Arbeitsverzeichnis aufwärts das Verzeichnis, das `src-tauri/faelle` enthält.
 */
object GemeinsameFaelle {
    /** Pfad der Fälle relativ zur Repo-Wurzel; `scripts/bereiche.test.sh` sucht dieses Literal. */
    const val VERZEICHNIS = "src-tauri/faelle"

    private val json = Json { ignoreUnknownKeys = true }

    fun wurzel(): File {
        var ordner: File? = File("").absoluteFile
        while (ordner != null) {
            if (File(ordner, VERZEICHNIS).isDirectory) return ordner
            ordner = ordner.parentFile
        }
        error("Repo-Wurzel mit $VERZEICHNIS nicht gefunden (gesucht ab ${File("").absolutePath})")
    }

    fun <T> load(name: String, serializer: KSerializer<T>): T {
        val datei = File(File(wurzel(), VERZEICHNIS), name)
        return json.decodeFromString(serializer, datei.readText(Charsets.UTF_8))
    }
}
