FROM docker.io/gradle:8.10-jdk21-alpine AS builder

WORKDIR /app

# Cache dependency resolution layer
COPY build.gradle.kts settings.gradle.kts ./
RUN gradle dependencies --no-daemon -q 2>/dev/null || true

COPY src ./src
RUN gradle bootJar --no-daemon -q

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM docker.io/eclipse-temurin:21-jre-alpine

WORKDIR /app

RUN addgroup -S remi && adduser -S remi -G remi

COPY --from=builder /app/build/libs/*.jar app.jar

USER remi

EXPOSE 3100

ENTRYPOINT ["java", \
  "-XX:+UseZGC", \
  "-XX:MaxRAMPercentage=75.0", \
  "-jar", "app.jar"]
