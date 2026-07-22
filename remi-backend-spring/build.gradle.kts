plugins {
    id("org.springframework.boot") version "3.3.5"
    id("io.spring.dependency-management") version "1.1.6"
    java
}

group = "com.remi"
version = "1.0.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    // ClickHouse JDBC — :all shades all HTTP client deps to avoid conflicts
    implementation("com.clickhouse:clickhouse-jdbc:0.7.2:all")
    // Postgres — identity layer (orgs, api_keys, audit_log, pii_policies)
    implementation("org.postgresql:postgresql:42.7.4")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}
