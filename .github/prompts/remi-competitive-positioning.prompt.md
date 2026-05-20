---
name: "remi-competitive-positioning"
description: "Compare Remi against adjacent LLM observability and agent observability products without unsupported claims, using repository evidence and clearly labeled inference"
agent: "Sales Website Strategist"
argument-hint: "[competitors or categories] [target buyer] [website goal]"
---

Create an evidence-backed competitive positioning brief for **Remi**.

**Comparison set:** ${input:comparison_set:Name the competitors or adjacent categories to compare against (for example: "LangSmith, Helicone, Arize Phoenix, open-source observability stacks")}

**Target buyer:** ${input:target_buyer:Who is this for? (for example: "platform teams running LangChain agents in production")}

**Website goal:** ${input:website_goal:What will this be used for? (for example: "homepage positioning", "comparison page", "sales narrative")}

## Instructions

Use the Remi repository as the primary source of truth.

1. Start by summarizing what Remi does in operational terms from the repository.
2. Compare Remi only on dimensions that are supported by the Remi codebase, READMEs, architecture docs, deployment files, or implementation plans.
3. If competitor evidence is not present in the workspace, compare Remi to **adjacent product categories or commonly known market expectations**, and explicitly label those points as inference.
4. Do not claim competitor weaknesses, benchmarks, integrations, compliance posture, pricing, or feature gaps unless the evidence is supplied in the prompt or present in the workspace.
5. Prefer contrast framing such as "Remi appears optimized for..." or "Based on the repository evidence, Remi emphasizes..." instead of absolute superiority claims.
6. Surface trust gaps honestly when Remi evidence is thin, incomplete, or still aspirational.

## Required Output

### 1. Remi Category Fit
- What category Remi fits into.
- Which adjacent categories it overlaps with.
- Which buyer problem it seems most aligned to solve.

### 2. Comparison Axes
- 5 to 8 comparison dimensions that matter to the specified buyer.
- For each axis, explain why it matters.

### 3. Evidence-Backed Positioning
- For each axis, state what the repository supports about Remi.
- Separate **direct evidence** from **inference**.
- Include file paths used as proof.

### 4. Safe Competitive Narrative
- 3 to 5 positioning statements suitable for sales or website use.
- Each statement must stay within supported evidence.

### 5. Overclaim Risks
- Claims that sound persuasive but are not sufficiently supported yet.
- Missing proof that would be needed before making stronger comparison claims.

### 6. Website Copy Inputs
- A comparison-page headline.
- A subhead.
- 3 value propositions.
- 3 proof points.

### 7. Evidence Appendix
- List the Remi repository files used.
- Briefly note what each source proved.

If the prompt includes competitor notes, links, or internal battlecards, use them. Otherwise, stay conservative and category-based.