package dev.rubeen.lifeline.kern

import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/**
 * Liest die gemeinsamen Fälle aller Hüllen (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“).
 *
 * Eine Quelle, keine Kopie: die Suite sucht ab dem Arbeitsverzeichnis des Testlaufs aufwärts
 * das Verzeichnis, das `src-tauri/faelle` enthält. Ein neuer Fall kommt in die JSON, nie nur in
 * einen Kotlin-Test.
 */
object GemeinsameFaelle {
    /** Pfad der Fälle relativ zur Repo-Wurzel; `scripts/bereiche.test.sh` sucht dieses Literal. */
    const val VERZEICHNIS = "src-tauri/faelle"

    private val json = Json { ignoreUnknownKeys = true }

    private fun wurzel(): File {
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
