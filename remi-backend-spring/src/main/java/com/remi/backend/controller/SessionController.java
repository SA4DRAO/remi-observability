package com.remi.backend.controller;

import com.remi.backend.auth.KeyContext;
import com.remi.backend.dto.*;
import com.remi.backend.repository.ClickHouseRepository;
import com.remi.backend.repository.ClickHouseRepository.SessionRow;
import com.remi.backend.repository.ClickHouseRepository.SpanRow;
import com.remi.backend.repository.IdentityRepository;
import com.remi.backend.service.JudgeService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/sessions")
public class SessionController {

    private static final Logger log = LoggerFactory.getLogger(SessionController.class);

    private final ClickHouseRepository repo;
    private final IdentityRepository identity;
    private final JudgeService judge;
    private final ObjectMapper mapper;

    public SessionController(ClickHouseRepository repo, IdentityRepository identity,
                             JudgeService judge, ObjectMapper mapper) {
        this.repo = repo;
        this.identity = identity;
        this.judge = judge;
        this.mapper = mapper;
    }

    // Attribute keys that carry captured prompt/response content — shared with
    // the judge (JudgeService.isPromptAttr). Reading them requires the
    // read:prompts scope and produces an audit_log row.
    private static boolean isPromptAttr(String key) {
        return JudgeService.isPromptAttr(key);
    }

    // GET /api/v1/sessions
    @GetMapping
    public ApiResponse<Map<String, Object>> listSessions(
            HttpServletRequest req,
            @RequestParam(name = "agent_id",  required = false) String agentId,
            @RequestParam(name = "date_from", required = false) String startDate,
            @RequestParam(name = "date_to",   required = false) String endDate,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {

        KeyContext ctx = KeyContext.of(req);
        limit  = Math.min(Math.max(limit, 1), 200);
        offset = Math.max(offset, 0);

        var result = repo.listSessions(ctx.orgId(), agentId, startDate, endDate, status, limit, offset);
        List<Session> sessions = result.rows().stream().map(this::toSession).toList();
        return ApiResponse.ok(Map.of(
                "sessions",   sessions,
                "pagination", Pagination.of(limit, offset, result.total())));
    }

    // GET /api/v1/sessions/:id
    @GetMapping("/{sessionId}")
    public ResponseEntity<ApiResponse<SessionDetail>> detail(
            HttpServletRequest req, @PathVariable String sessionId) {
        KeyContext ctx = KeyContext.of(req);
        return repo.getSession(ctx.orgId(), sessionId)
                .map(row -> {
                    var models   = repo.getModelUsage(ctx.orgId(), sessionId);
                    var tools    = repo.getToolUsage(ctx.orgId(), sessionId);
                    var resource = repo.getSessionResource(ctx.orgId(), sessionId);
                    return ResponseEntity.ok(ApiResponse.ok(toSessionDetail(row, models, tools, resource)));
                })
                .orElseGet(() -> ResponseEntity.status(404).body(new ApiResponse<>(false, null)));
    }

    // GET /api/v1/sessions/:id/system-metrics — CPU/memory/runtime time series
    // emitted by the agent's OTLP metrics exporter during the session window.
    @GetMapping("/{sessionId}/system-metrics")
    public ResponseEntity<?> systemMetrics(HttpServletRequest req, @PathVariable String sessionId) {
        KeyContext ctx = KeyContext.of(req);
        var session = repo.getSession(ctx.orgId(), sessionId).orElse(null);
        if (session == null) {
            return ResponseEntity.status(404).body(Map.of("success", false, "error", "Session not found"));
        }
        if (session.agentId().isEmpty() || session.startedAt() == null) {
            return ResponseEntity.ok(ApiResponse.ok(Map.of("metrics", List.of())));
        }
        // Pad the window: the periodic exporter flushes on its own clock.
        var from = Instant.parse(session.startedAt()).minusSeconds(30).toString();
        var to = Instant.parse(
                session.endedAt() != null ? session.endedAt() : session.startedAt())
                .plusSeconds(30).toString();

        var points = repo.getSystemMetrics(ctx.orgId(), session.agentId(), from, to);

        // Group into series: one per metric name (+ state dimension when present).
        Map<String, List<Map<String, Object>>> series = new LinkedHashMap<>();
        for (var p : points) {
            String key = p.state().isEmpty() ? p.metric() : p.metric() + " (" + p.state() + ")";
            series.computeIfAbsent(key, k -> new ArrayList<>())
                    .add(Map.of("ts", p.timestamp(), "value", p.value()));
        }
        List<Map<String, Object>> metrics = series.entrySet().stream()
                .map(e -> Map.<String, Object>of("name", e.getKey(), "points", e.getValue()))
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("metrics", metrics)));
    }

    // GET /api/v1/sessions/:id/spans
    @GetMapping("/{sessionId}/spans")
    public ApiResponse<Map<String, Object>> spans(
            HttpServletRequest req,
            @PathVariable String sessionId,
            @RequestParam(required = false) String kind,
            @RequestParam(defaultValue = "200") int limit,
            @RequestParam(defaultValue = "0") int offset) {

        KeyContext ctx = KeyContext.of(req);
        limit  = Math.min(Math.max(limit, 1), 1000);
        offset = Math.max(offset, 0);
        var result = repo.getSpansForSession(ctx.orgId(), sessionId, kind, limit, offset);
        boolean canReadPrompts = ctx.hasScope("read:prompts");
        List<Span> spans = result.rows().stream()
                .map(row -> toSpan(row, canReadPrompts))
                .toList();
        return ApiResponse.ok(Map.of(
                "spans",      spans,
                "pagination", Pagination.of(limit, offset, result.total())));
    }

    // GET /api/v1/sessions/spans/search?q=X&limit=N
    @GetMapping("/spans/search")
    public ApiResponse<List<Map<String, Object>>> searchSpans(
            HttpServletRequest req,
            @RequestParam("q") String query,
            @RequestParam(defaultValue = "30") int limit) {

        KeyContext ctx = KeyContext.of(req);
        limit = Math.min(Math.max(limit, 1), 100);
        if (query == null || query.trim().length() < 2) {
            return ApiResponse.ok(List.of());
        }
        // Searching prompt bodies is a prompt read: same scope, same audit trail.
        boolean canReadPrompts = ctx.hasScope("read:prompts");
        var results = repo.searchSpans(ctx.orgId(), query.trim(), limit, canReadPrompts);
        if (canReadPrompts && results.stream().anyMatch(r -> !String.valueOf(
                r.getOrDefault("snippet", "")).isEmpty())) {
            identity.audit(ctx.orgId(), ctx.keyId(), "read:prompt_content", "search", query.trim());
        }
        return ApiResponse.ok(results);
    }

    // GET /api/v1/sessions/spans/:spanId/attributes
    @GetMapping("/spans/{spanId}/attributes")
    public ResponseEntity<ApiResponse<Map<String, Object>>> spanAttributes(
            HttpServletRequest req, @PathVariable String spanId) {
        KeyContext ctx = KeyContext.of(req);
        boolean canReadPrompts = ctx.hasScope("read:prompts");
        return repo.getSpan(ctx.orgId(), spanId)
                .map(row -> {
                    Map<String, String> attrs = redactPrompts(row.attributes(), canReadPrompts);
                    if (canReadPrompts && row.attributes().keySet().stream().anyMatch(SessionController::isPromptAttr)) {
                        identity.audit(ctx.orgId(), ctx.keyId(), "read:prompt_content", "span", spanId);
                    }
                    return ResponseEntity.ok(ApiResponse.ok(
                            Map.<String, Object>of("span_id", spanId, "attributes", attrs)));
                })
                .orElseGet(() -> ResponseEntity.status(404).body(new ApiResponse<>(false, null)));
    }

    // DELETE /api/v1/sessions/:id
    @DeleteMapping("/{sessionId}")
    public ApiResponse<Map<String, String>> delete(HttpServletRequest req, @PathVariable String sessionId) {
        KeyContext ctx = KeyContext.of(req);
        repo.deleteSession(ctx.orgId(), sessionId);
        identity.audit(ctx.orgId(), ctx.keyId(), "delete:session", "session", sessionId);
        log.info("Session deleted: {} (org {})", sessionId, ctx.orgId());
        return ApiResponse.ok(Map.of("session_id", sessionId));
    }

    // ── LLM-as-a-judge span analysis ────────────────────────────────────────────

    // Global SNAKE_CASE naming maps this to "span_id"; the dashboard sends "spanId".
    public record AnalyzeRequest(
            @com.fasterxml.jackson.annotation.JsonAlias("spanId") String spanId) {}

    // POST /api/v1/sessions/:id/analyze-span  {spanId}
    @PostMapping("/{sessionId}/analyze-span")
    public ResponseEntity<?> analyzeSpan(
            HttpServletRequest req,
            @PathVariable String sessionId,
            @RequestBody AnalyzeRequest body) throws Exception {

        KeyContext ctx = KeyContext.of(req);
        if (body.spanId() == null || body.spanId().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "spanId is required"));
        }
        if (!judge.isConfigured()) {
            return ResponseEntity.status(503).body(Map.of("success", false, "error",
                    "Judge model not configured (set OPENROUTER_API_KEY)"));
        }

        String spanId = body.spanId().trim();
        SpanRow target = repo.getSpan(ctx.orgId(), spanId).orElse(null);
        if (target == null) {
            return ResponseEntity.status(404).body(Map.of("success", false, "error", "Span not found"));
        }
        List<SpanRow> spans = repo.getSpansForSession(ctx.orgId(), sessionId, null, 500, 0).rows();

        boolean canReadPrompts = ctx.hasScope("read:prompts");
        String userPrompt = JudgeService.buildJudgePrompt(target, spans, canReadPrompts);

        Map<String, Object> analysis;
        try {
            analysis = judge.analyze(userPrompt);
        } catch (Exception e) {
            log.error("Judge call failed for span {}: {}", spanId, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("success", false, "error",
                    "Judge model call failed: " + e.getMessage()));
        }

        // Persist for audit trail; failure to persist should not fail the request.
        try {
            repo.saveSpanAnalysis(ctx.orgId(), sessionId, spanId,
                    judge.modelUsed(), mapper.writeValueAsString(analysis));
        } catch (Exception e) {
            log.warn("Failed to persist span analysis for {}: {}", spanId, e.getMessage());
        }
        if (canReadPrompts) {
            identity.audit(ctx.orgId(), ctx.keyId(), "read:prompt_content", "span", spanId);
        }
        identity.audit(ctx.orgId(), ctx.keyId(), "analyze:span", "span", spanId);

        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "span_id", spanId,
                "model_used", judge.modelUsed(),
                "analysis", analysis)));
    }

    // GET /api/v1/sessions/:id/spans/:spanId/analysis — latest stored verdict
    @GetMapping("/{sessionId}/spans/{spanId}/analysis")
    public ResponseEntity<?> latestAnalysis(
            HttpServletRequest req,
            @PathVariable String sessionId,
            @PathVariable String spanId) {
        KeyContext ctx = KeyContext.of(req);
        return repo.getLatestSpanAnalysis(ctx.orgId(), spanId)
                .<ResponseEntity<?>>map(row -> {
                    Object parsed;
                    try {
                        parsed = mapper.readValue(String.valueOf(row.get("analysis")), Map.class);
                    } catch (Exception e) {
                        parsed = Map.of("summary", String.valueOf(row.get("analysis")));
                    }
                    return ResponseEntity.ok(ApiResponse.ok(Map.of(
                            "span_id", spanId,
                            "model_used", String.valueOf(row.get("model_used")),
                            "created_at", String.valueOf(row.get("created_at")),
                            "analysis", parsed)));
                })
                .orElseGet(() -> ResponseEntity.status(404).body(new ApiResponse<>(false, null)));
    }

    private static Map<String, String> redactPrompts(Map<String, String> attrs, boolean canReadPrompts) {
        if (canReadPrompts) return attrs;
        Map<String, String> out = new LinkedHashMap<>();
        for (var e : attrs.entrySet()) {
            out.put(e.getKey(), isPromptAttr(e.getKey())
                    ? "[redacted — key lacks read:prompts scope]"
                    : e.getValue());
        }
        return out;
    }

    // ── Mapping helpers ─────────────────────────────────────────────────────────

    private Session toSession(SessionRow row) {
        long total = row.inputTokens() + row.outputTokens() + row.cacheTokens();
        return new Session(
                row.sessionId(),
                row.agentId().isEmpty()   ? null : row.agentId(),
                row.orgId().isEmpty()     ? null : row.orgId(),
                row.startedAt(),
                row.endedAt(),
                row.durationMs() <= 0    ? null : row.durationMs(),
                row.status(),
                row.primaryModel(),
                row.spanCount(),
                row.llmCalls(),
                row.toolCalls(),
                row.inputTokens(),
                row.outputTokens(),
                row.cacheTokens(),
                total,
                row.avgLlmLatencyMs());
    }

    private SessionDetail toSessionDetail(
            SessionRow row,
            Map<String, ModelStat> models,
            Map<String, ToolStat> tools,
            Map<String, String> resource) {
        Session s = toSession(row);
        return new SessionDetail(
                s.sessionId(), s.agentId(), s.orgId(), s.startedAt(), s.endedAt(), s.durationMs(),
                s.status(), s.primaryModel(), s.spanCount(), s.llmCalls(), s.toolCalls(),
                s.inputTokens(), s.outputTokens(), s.cacheTokens(), s.totalTokens(), s.avgLlmLatencyMs(),
                models, tools, resource);
    }

    private Span toSpan(SpanRow row, boolean canReadPrompts) {
        return new Span(
                row.spanId(),
                row.parentSpanId().isEmpty() ? null : row.parentSpanId(),
                row.traceId(),
                row.spanName(),
                row.kind(),
                row.status(),
                row.statusMessage(),
                row.startedAt(),
                row.durationMs(),
                row.sessionId(),
                row.serviceName().isEmpty() ? null : row.serviceName(),
                row.model(),
                row.provider(),
                row.inputTokens(),
                row.outputTokens(),
                row.cacheTokens(),
                redactPrompts(row.attributes(), canReadPrompts));
    }
}
