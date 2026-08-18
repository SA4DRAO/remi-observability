package com.remi.backend.controller;

import com.remi.backend.auth.KeyContext;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.util.Map;
import java.util.Set;

/**
 * Authenticated OTLP ingest: agents point OTEL_EXPORTER_OTLP_ENDPOINT at this
 * backend with their org's API key. The raw OTLP payload is forwarded untouched
 * to the internal collector with X-Remi-Org set from the validated key — the
 * collector stamps it onto every span's resource attributes. The collector's own
 * port is not reachable from outside the compose network, so this is the only
 * ingest path.
 */
@RestController
public class IngestController {

    private static final Logger log = LoggerFactory.getLogger(IngestController.class);
    private static final Set<String> SIGNALS = Set.of("traces", "metrics", "logs");

    // ponytail: a default OTLP batch (512 spans) is tens of KB even with full prompts,
    // so 4MB is generous. Raise it if a legitimate exporter ever trips the 413.
    private static final int MAX_BODY_BYTES = 4 * 1024 * 1024;

    private final RestClient collector;

    public IngestController(@Value("${remi.collector-endpoint}") String collectorEndpoint) {
        this.collector = RestClient.builder().baseUrl(collectorEndpoint).build();
    }

    @PostMapping("/v1/{signal}")
    public ResponseEntity<?> ingest(
            HttpServletRequest req,
            @PathVariable String signal,
            @RequestHeader(value = "Content-Type", defaultValue = "application/x-protobuf") String contentType)
            throws IOException {

        if (!SIGNALS.contains(signal)) {
            return ResponseEntity.status(404).body(Map.of("success", false, "error", "Unknown signal"));
        }
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.hasScope("write:sessions")) {
            return ResponseEntity.status(403).body(Map.of("success", false, "error", "Key lacks write:sessions scope"));
        }

        // Read the body ourselves rather than via @RequestBody so an oversized payload
        // is refused instead of being materialised into the heap first. readNBytes
        // caps chunked uploads too, where Content-Length would have been absent.
        byte[] body = req.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) {
            log.warn("Rejected oversized {} payload from org {}", signal, ctx.orgId());
            return ResponseEntity.status(413).body(Map.of(
                    "success", false,
                    "error", "Payload exceeds " + (MAX_BODY_BYTES / (1024 * 1024)) + "MB; lower OTEL_BSP_MAX_EXPORT_BATCH_SIZE"));
        }

        try {
            return collector.post()
                    .uri("/v1/" + signal)
                    .contentType(MediaType.parseMediaType(contentType))
                    .header("X-Remi-Org", ctx.orgId())
                    .body(body)
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        byte[] respBody = response.getBody().readAllBytes();
                        return ResponseEntity.status(status)
                                .contentType(MediaType.parseMediaType(
                                        response.getHeaders().getFirst("Content-Type") != null
                                                ? response.getHeaders().getFirst("Content-Type")
                                                : "application/x-protobuf"))
                                .body(respBody);
                    });
        } catch (Exception e) {
            log.error("Collector forward failed for org {}: {}", ctx.orgId(), e.getMessage());
            return ResponseEntity.status(502).body(Map.of("success", false, "error", "Collector unavailable"));
        }
    }
}
