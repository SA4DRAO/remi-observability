#!/usr/bin/env python3
"""Sync model pricing from LiteLLM's open-source pricing data into Postgres.

Usage:
    python scripts/sync-model-pricing.py          # one-shot sync
    python scripts/sync-model-pricing.py --dry-run # preview without writing

Environment variables (same as remi-worker):
    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

The script fetches LiteLLM's model_prices_and_context_window.json, extracts
input/output costs, and upserts into the ``model_pricing`` table.  Manual
overrides (source='manual') are never overwritten.

Can be run as a cron job, Kubernetes CronJob, or called from the worker at
startup.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

import httpx

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-5s %(message)s",
)
logger = logging.getLogger(__name__)

# LiteLLM community-maintained pricing data
LITELLM_PRICING_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)


def fetch_litellm_data() -> Dict[str, Any]:
    """Download and parse the LiteLLM pricing JSON."""
    logger.info("Fetching LiteLLM pricing data from %s", LITELLM_PRICING_URL)
    resp = httpx.get(LITELLM_PRICING_URL, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    # The file has a top-level "sample_spec" key that's metadata, skip it
    data.pop("sample_spec", None)
    logger.info("Fetched pricing for %d model entries", len(data))
    return data


def _infer_provider(model_name: str, entry: Dict[str, Any]) -> Optional[str]:
    """Best-effort provider extraction from LiteLLM entry."""
    provider = entry.get("litellm_provider")
    if provider:
        return str(provider).split("/")[0].lower()
    # Fallback: parse from model name prefix  (e.g. "openai/gpt-4o")
    if "/" in model_name:
        return model_name.split("/")[0].lower()
    return None


def parse_models(
    raw: Dict[str, Any],
) -> List[Tuple[str, float, float, Optional[str], Optional[int], Optional[int]]]:
    """Extract (model_name, input_cost_per_1m, output_cost_per_1m, provider,
    max_input_tokens, max_output_tokens) tuples from LiteLLM data.

    LiteLLM stores costs in **per-token** (not per-1M), so we multiply by 1e6.
    """
    results = []
    for model_name, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        input_per_token = entry.get("input_cost_per_token")
        output_per_token = entry.get("output_cost_per_token")
        if input_per_token is None and output_per_token is None:
            continue  # skip entries with no pricing

        input_per_1m = round(float(input_per_token or 0) * 1_000_000, 6)
        output_per_1m = round(float(output_per_token or 0) * 1_000_000, 6)

        provider = _infer_provider(model_name, entry)

        # Strip provider prefix from model name if present (e.g. "openai/gpt-4o" -> "gpt-4o")
        # but also keep the full name as a separate entry for exact-match lookups.
        clean_name = model_name.split("/", 1)[-1] if "/" in model_name else model_name

        max_input = entry.get("max_input_tokens") or entry.get("max_tokens")
        max_output = entry.get("max_output_tokens")

        max_input_int = int(max_input) if max_input is not None else None
        max_output_int = int(max_output) if max_output is not None else None

        results.append(
            (clean_name, input_per_1m, output_per_1m, provider, max_input_int, max_output_int)
        )
        # Also add with provider prefix for APIs that report "openai/gpt-4o"
        if "/" in model_name and model_name != clean_name:
            results.append(
                (model_name, input_per_1m, output_per_1m, provider, max_input_int, max_output_int)
            )

    # Deduplicate by model_name (keep last occurrence)
    seen: Dict[str, Tuple] = {}
    for row in results:
        seen[row[0]] = row
    deduped = list(seen.values())
    logger.info("Parsed %d unique model pricing entries", len(deduped))
    return deduped


def upsert_pricing(
    models: List[Tuple[str, float, float, Optional[str], Optional[int], Optional[int]]],
    *,
    dry_run: bool = False,
) -> int:
    """Upsert pricing rows into Postgres.  Returns count of upserted rows.

    Manual overrides (source='manual') are NOT overwritten.
    """
    import psycopg2  # type: ignore[import-not-found]

    dsn = (
        f"host={os.getenv('DB_HOST', 'localhost')} "
        f"port={os.getenv('DB_PORT', '5432')} "
        f"user={os.getenv('DB_USER', 'remi_user')} "
        f"password={os.getenv('DB_PASSWORD', 'remi_password')} "
        f"dbname={os.getenv('DB_NAME', 'remi_db')}"
    )

    if dry_run:
        logger.info("[DRY RUN] Would upsert %d models", len(models))
        for name, inp, out, prov, _, _ in models[:20]:
            logger.info("  %-40s  in=$%.4f/1M  out=$%.4f/1M  (%s)", name, inp, out, prov)
        if len(models) > 20:
            logger.info("  ... and %d more", len(models) - 20)
        return 0

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        upserted = 0
        for name, inp, out, prov, max_in, max_out in models:
            cur.execute(
                """
                INSERT INTO model_pricing
                    (model_name, input_cost_per_1m, output_cost_per_1m,
                     provider, source, max_input_tokens, max_output_tokens, updated_at)
                VALUES (%s, %s, %s, %s, 'litellm', %s, %s, NOW())
                ON CONFLICT (model_name) DO UPDATE SET
                    input_cost_per_1m  = EXCLUDED.input_cost_per_1m,
                    output_cost_per_1m = EXCLUDED.output_cost_per_1m,
                    provider           = COALESCE(EXCLUDED.provider, model_pricing.provider),
                    max_input_tokens   = COALESCE(EXCLUDED.max_input_tokens, model_pricing.max_input_tokens),
                    max_output_tokens  = COALESCE(EXCLUDED.max_output_tokens, model_pricing.max_output_tokens),
                    source             = 'litellm',
                    updated_at         = NOW()
                WHERE model_pricing.source != 'manual'
                """,
                (name, inp, out, prov, max_in, max_out),
            )
            upserted += cur.rowcount
        conn.commit()
        logger.info("Upserted %d rows (%d skipped manual overrides)", upserted, len(models) - upserted)
        return upserted
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync LiteLLM pricing → model_pricing table")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    args = parser.parse_args()

    try:
        raw = fetch_litellm_data()
    except Exception as exc:
        logger.error("Failed to fetch LiteLLM data: %s", exc)
        sys.exit(1)

    models = parse_models(raw)
    if not models:
        logger.warning("No models parsed — nothing to upsert")
        sys.exit(0)

    upsert_pricing(models, dry_run=args.dry_run)
    logger.info("Done.")


if __name__ == "__main__":
    main()
