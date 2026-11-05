"""Meta Model API integrations with a persistent cost ceiling and explicit failures.

Rates checked 2026-11-04: https://dev.meta.ai/docs/pricing-rate-limits
Standard mode only. Glimmer is self-hosted; it is never silently replaced by Spark.
"""
import hashlib
import json
import os
import math
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .budget import BudgetLedger

ROOT = Path(__file__).resolve().parents[1]
META_URL = "https://api.meta.ai/v1"
TOKEN_RATES = {"muse-spark-1.3": (1.25, 4.25), "muse-wonder-1.0": (4.0, 20.0)}


def load_env():
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                name, value = line.split("=", 1)
                os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


class ProviderUnavailable(RuntimeError):
    pass


class ModelClient:
    def __init__(self, ledger=None, transport=None):
        load_env()
        self.ledger = ledger or BudgetLedger()
        self.transport = transport or self._http

    @staticmethod
    def _http(url, key, payload):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = "Bearer " + key
        request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        try:
            # SAM drives an interactive view. A stalled frame must not hold its
            # local inference slot for two minutes; other model deadlines stay unchanged.
            with urllib.request.urlopen(request, timeout=15 if payload.get("model") == "sam-3.1" else 120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Never echo response bodies: a provider might repeat submitted credentials or data.
            raise ProviderUnavailable("Provider returned HTTP %s" % error.code) from None
        except (urllib.error.URLError, TimeoutError) as error:
            raise ProviderUnavailable("Provider connection failed (%s)" % type(error).__name__) from None

    def _request(self, path, payload, scene, reserve, cost, base=META_URL, key=None):
        if key is None:
            key = os.environ.get("META_MODEL_API_KEY", "")
            if not key:
                raise ProviderUnavailable("META_MODEL_API_KEY is not configured")
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        rid = self.ledger.reserve(scene, payload["model"], reserve, digest)
        try:
            response = self.transport(base.rstrip("/") + path, key, payload)
        except Exception:
            self.ledger.settle(rid, {}, status="failed_cost_unconfirmed")
            raise
        usage = response.get("usage") or {}
        self.ledger.settle(rid, usage, cost(response), status="completed")
        response["twinforge_receipt"] = {"request_id": rid, "model": payload["model"], "request_sha256": digest}
        audit = {"receipt": response["twinforge_receipt"], "usage": usage,
                 "choices": [{"finish_reason": c.get("finish_reason"), "content": c.get("message", {}).get("content")}
                             for c in response.get("choices", [])]}
        folder = self.ledger.root / "provider-responses"
        folder.mkdir(exist_ok=True)
        (folder / (rid + ".json")).write_text(json.dumps(audit, ensure_ascii=False, indent=2))
        return response

    def chat(self, messages, model="muse-spark-1.3", scene="hoop", schema=None, max_tokens=1600):
        if model not in TOKEN_RATES:
            raise ValueError("Unsupported scientific-agent model")
        max_tokens = max(1, min(int(max_tokens), 4096))
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "reasoning_effort": "low"}
        if schema:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "twinforge_result", "strict": True, "schema": schema}}
        input_size = len(json.dumps(payload).encode()) + 1024
        if input_size > 60000:
            raise ValueError("Scientific context is too large; use measured summaries")
        ri, ro = TOKEN_RATES[model]
        reserve = (input_size * ri + max_tokens * ro) / 1_000_000
        def cost(response):
            usage = response.get("usage", {})
            ni = usage.get("prompt_tokens", usage.get("input_tokens"))
            no = usage.get("completion_tokens", usage.get("output_tokens"))
            return None if ni is None or no is None else (ni * ri + no * ro) / 1_000_000
        return self._request("/chat/completions", payload, scene, reserve, cost)

    def segment(self, image_b64, concept, scene="hoop"):
        payload = {"model": "sam-3.1", "input": [{"role": "user", "content": [
            {"type": "input_text", "text": concept},
            {"type": "input_image", "image_url": "data:image/jpeg;base64," + image_b64}]}]}
        return self._request("/responses", payload, scene, 0.0025, lambda _: 0.0025)

    def image(self, prompt, scene="hoop"):
        payload = {"model": "muse-image-1.0", "prompt": prompt[:6000], "n": 1,
                   "output_format": "png", "response_format": "b64_json"}
        return self._request("/images/generations", payload, scene, 0.01,
                             lambda r: 0.01 if any(item.get("b64_json") or item.get("url") for item in r.get("data", [])) else None)

    def narrate(self, evidence, scene="hoop"):
        base = os.environ.get("GLIMMER_BASE_URL", "").strip()
        together_key = os.environ.get("TOGETHER_API_KEY", "")
        if not base and together_key:
            base = "https://api.together.ai/v1"
        if not base:
            raise ProviderUnavailable("Muse Glimmer endpoint is not configured (GLIMMER_BASE_URL)")
        host = urllib.parse.urlsplit(base).hostname
        local = host in {"127.0.0.1", "localhost", "::1"}
        together = host in {"api.together.ai", "api.together.xyz"}
        model = os.environ.get("GLIMMER_MODEL") or ("meta-models/Muse-Glimmer-30B" if together else "muse-glimmer")
        key = os.environ.get("GLIMMER_API_KEY", "") or (together_key if together else "")
        if not local and not key:
            raise ProviderUnavailable("Hosted Glimmer requires a provider API key")
        # Local dollars exclude hardware cost; remote calls must never be labelled free.
        if local:
            rates = (0., 0.)
        elif together:
            rates = (.35, 1.50)  # https://www.together.ai/models/muse-glimmer, checked 2026-11-04.
        else:
            try:
                rates = (float(os.environ["GLIMMER_INPUT_USD_PER_MILLION"]), float(os.environ["GLIMMER_OUTPUT_USD_PER_MILLION"]))
            except (KeyError, ValueError):
                raise ProviderUnavailable("Configure hosted Glimmer token prices before spending") from None
            if not all(math.isfinite(r) and r >= 0 for r in rates):
                raise ValueError("Glimmer rates must be finite nonnegative values")
        from .narration import summarize
        payload = {"model": model, "max_tokens": 512, "messages": [
            {"role": "system", "content": "Narrate only anomalies supported by the supplied measurements, in French. State missing evidence. Do not invent a run, metric or physical experiment."},
            {"role": "user", "content": json.dumps(summarize(evidence), ensure_ascii=False)}]}
        ri, ro = rates
        reserve = ((len(json.dumps(payload).encode()) + 1024) * ri + 512 * ro) / 1_000_000
        def cost(response):
            if local: return 0.
            usage = response.get("usage", {})
            ni, no = usage.get("prompt_tokens"), usage.get("completion_tokens")
            return None if ni is None or no is None else (ni * ri + no * ro) / 1_000_000
        return self._request("/chat/completions", payload, scene, reserve, cost, base=base, key=key)


def message_content(response):
    choices = response.get("choices") or []
    content = choices[0].get("message", {}).get("content") if choices else None
    if not isinstance(content, str) or not content.strip():
        raise ProviderUnavailable("Provider returned no usable response")
    return content
