package com.remi.backend.controller;

import com.remi.backend.auth.KeyContext;
import com.remi.backend.dto.Analytics;
import com.remi.backend.dto.ApiResponse;
import com.remi.backend.repository.ClickHouseRepository;
import com.remi.backend.repository.IdentityRepository;
import com.remi.backend.service.JudgeService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

    private static final Logger log = LoggerFactory.getLogger(AnalyticsController.class);

    private final ClickHouseRepository repo;
    private final IdentityRepository identity;
    private final JudgeService judge;
    private final ObjectMapper mapper;

    public AnalyticsController(ClickHouseRepository repo, IdentityRepository identity,
                               JudgeService judge, ObjectMapper mapper) {
        this.repo = repo;
        this.identity = identity;
        this.judge = judge;
        this.mapper = mapper;
    }

    // GET /api/v1/analytics?agent_id=Y&date_from=Z&date_to=W&days=30
    // org scope always comes from the API key.
    @GetMapping
    public ApiResponse<Analytics> analytics(
            HttpServletRequest req,
            @RequestParam(name = "agent_id",  required = false) String agentId,
            @RequestParam(name = "date_from", required = false) String startDate,
            @RequestParam(name = "date_to",   required = false) String endDate,
            @RequestParam(defaultValue = "30") int days) {

        KeyContext ctx = KeyContext.of(req);
        days = Math.min(Math.max(days, 1), 365);
        Analytics result = repo.getAnalytics(ctx.orgId(), agentId, startDate, endDate, days);
        return ApiResponse.ok(result);
    }

    // GET /api/v1/analytics/versions?agent_id=Y&date_from=Z&date_to=W —
    // per-service.version regression comparison: latency, error rate, tokens,
    // system metrics, judge scores.
    // Same window semantics as /analytics: the dashboard's scope bar drives both,
    // so a release that fell outside the window disappears from both views
    // instead of the Versions page silently reporting all-time numbers.
    @GetMapping("/versions")
    public ApiResponse<List<com.remi.backend.dto.VersionStats>> versions(
            HttpServletRequest req,
            @RequestParam(name = "agent_id",  required = false) String agentId,
            @RequestParam(name = "date_from", required = false) String startDate,
            @RequestParam(name = "date_to",   required = false) String endDate) {
        KeyContext ctx = KeyContext.of(req);
        return ApiResponse.ok(repo.getVersionComparison(ctx.orgId(), agentId, startDate, endDate));
    }

    public record SampleJudgeRequest(String agent, String version, Integer sample) {}

    // POST /api/v1/analytics/versions/sample-judge {agent, version, sample?}
    // Judges up to N random not-yet-judged LLM spans of one agent's version so
    // its judge columns fill in without hunting spans manually. Sequential LLM
    // calls — expect a few seconds per span.
    @PostMapping("/versions/sample-judge")
    public ResponseEntity<?> sampleJudge(HttpServletRequest req, @RequestBody SampleJudgeRequest body) {
        KeyContext ctx = KeyContext.of(req);
        if (body.version() == null || body.version().isBlank()
                || body.agent() == null || body.agent().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "agent and version are required"));
        }
        if (!judge.isConfigured()) {
            return ResponseEntity.status(503).body(Map.of("success", false, "error",
                    "Judge model not configured (set OPENROUTER_API_KEY)"));
        }
        int sample = body.sample() != null ? Math.min(Math.max(body.sample(), 1), 5) : 3;
        boolean canReadPrompts = ctx.hasScope("read:prompts");

        var candidates = repo.pickUnjudgedLlmSpans(ctx.orgId(), body.agent().trim(), body.version().trim(), sample);
        int judged = 0;
        for (var row : candidates) {
            String spanId = String.valueOf(row.get("span_id"));
            String sessionId = String.valueOf(row.get("session_id"));
            try {
                var target = repo.getSpan(ctx.orgId(), spanId).orElse(null);
                if (target == null) continue;
                var spans = repo.getSpansForSession(ctx.orgId(), sessionId, null, 500, 0).rows();
                var analysis = judge.analyze(JudgeService.buildJudgePrompt(target, spans, canReadPrompts));
                repo.saveSpanAnalysis(ctx.orgId(), sessionId, spanId,
                        judge.modelUsed(), mapper.writeValueAsString(analysis));
                if (canReadPrompts) {
                    identity.audit(ctx.orgId(), ctx.keyId(), "read:prompt_content", "span", spanId);
                }
                identity.audit(ctx.orgId(), ctx.keyId(), "analyze:span", "span", spanId);
                judged++;
            } catch (Exception e) {
                log.warn("Sample-judge failed for span {}: {}", spanId, e.getMessage());
            }
        }
        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "agent", body.agent().trim(),
                "version", body.version().trim(),
                "candidates", candidates.size(),
                "judged", judged)));
    }
}
