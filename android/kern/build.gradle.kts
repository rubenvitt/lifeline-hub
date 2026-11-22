// Testbare Logik der Android-Hülle ohne Android-Klassen (LLH-1989). Reines Kotlin/JVM, damit
// `android/gradlew -p android/kern test` nur ein JDK braucht.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

group = "dev.rubeen.lifeline"

// JVM-Ziel 17 wie die App, ohne Toolchain-Suche: jedes JDK ab 17 baut den Kern.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // Die gemeinsamen Fälle liegen im Repo (`src-tauri/faelle`); GemeinsameFaelle findet die
    // Wurzel über das Arbeitsverzeichnis.
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
