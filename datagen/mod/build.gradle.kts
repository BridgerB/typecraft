plugins {
    id("fabric-loom") version "1.10-SNAPSHOT"
    java
}

val minecraftVersion = "26.1.2"
val fabricLoaderVersion = "0.18.4"
repositories {
    mavenCentral()
    maven("https://maven.fabricmc.net/")
}

dependencies {
    minecraft("com.mojang:minecraft:$minecraftVersion")
    mappings(loom.officialMojangMappings())
    modImplementation("net.fabricmc:fabric-loader:$fabricLoaderVersion")
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("fabric.mod.json") {
        expand("version" to project.version)
    }
}

// Standalone extractor for block-entity / entity model geometry.
// Runs as a plain JVM main (no Fabric loader) so it can load client-only
// classes that Fabric's server environment otherwise blocks.
tasks.register<JavaExec>("extractModels") {
    dependsOn("classes")
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.typecraft.datagen.ModelExtractor")
    args(project.findProperty("out") ?: "blockEntityModels.json")
}
