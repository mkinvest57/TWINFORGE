#!/usr/bin/env python3
"""TWINFORGE — serveur local : fichiers statiques + proxy API (clés côté serveur uniquement).

Les clés ne sont JAMAIS dans le code ni dans le navigateur :
elles sont lues depuis l'environnement ou un fichier `.env` local (ignoré par git).

  BASETEN_API_KEY      -> https://inference.baseten.co/v1  (modèle hackathon imposé)
  META_MODEL_API_KEY   -> https://api.meta.ai/v1           (Muse Spark / Wonder / SAM 3.1...)

Lancer :  python3 server.py   puis http://localhost:8000
"""
import json
import os
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASETEN_URL = "https://inference.baseten.co/v1"
BASETEN_MODEL = "meta-models/muse-spark-open-1026"  # imposé hackathon, ne pas changer
META_URL = "https://api.meta.ai/v1"
META_MODELS_ALLOWED = {"muse-spark-1.3", "muse-spark-1.3-contributor", "muse-wonder-1.0"}


def load_dotenv():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()


def chat(base_url, key, model, messages, max_tokens=900):
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    msg = (d.get("choices") or [{}])[0].get("message") or {}
    return {
        "model": d.get("model", model),
        "content": msg.get("content"),
        "reasoning": (msg.get("reasoning_content") or "")[:1200] or None,
        "usage": d.get("usage"),
    }


class Handler(SimpleHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/api/status":
            return self._json(200, {
                "baseten": bool(os.environ.get("BASETEN_API_KEY")),
                "baseten_model": BASETEN_MODEL,
                "meta": bool(os.environ.get("META_MODEL_API_KEY")),
                "meta_base": META_URL,
            })
        return super().do_GET()

    def do_POST(self):
        try:
            if self.path == "/api/advisor":
                body = self._read_json()
                ctx = str(body.get("context", ""))[:6000]
                messages = [
                    {"role": "system", "content": "Tu es l'agent scientifique de TWINFORGE. Tu analyses un journal d'induction physique (gravité, traînée, restitution estimés des seules observations, erreur tenue à l'écart). Réponds en français, concis, structuré : 1) diagnostic, 2) révision d'hypothèse proposée, 3) prochain test. N'invente aucun paramètre vrai."},
                    {"role": "user", "content": ctx or "Aucun tir encore : propose le premier protocole d'observation."},
                ]
                bk = os.environ.get("BASETEN_API_KEY", "").strip()
                if bk:
                    try:
                        out = chat(BASETEN_URL, bk, BASETEN_MODEL, messages, max_tokens=4096)
                        out["provider"] = "baseten"
                        return self._json(200, out)
                    except Exception as e:
                        err = e.read().decode()[:300] if hasattr(e, "read") else str(e)
                        print("Baseten fallback -> Meta:", err, flush=True)
                mk = os.environ.get("META_MODEL_API_KEY", "").strip()
                if mk:
                    out = chat(META_URL, mk, "muse-spark-1.3", messages, max_tokens=4096)
                    out["provider"] = "meta-model-api"
                    return self._json(200, out)
                return self._json(503, {"error": "Aucune clé API configurée côté serveur (.env). Voir .env.example."})
            if self.path == "/api/meta/chat":
                body = self._read_json()
                model = body.get("model", "muse-spark-1.3")
                if model not in META_MODELS_ALLOWED:
                    return self._json(400, {"error": f"Modèle non autorisé ici : {model}. Autorisés : {sorted(META_MODELS_ALLOWED)} (SAM 3.1 / image passent par leurs endpoints dédiés, pas le chat.)"})
                mk = os.environ.get("META_MODEL_API_KEY", "").strip()
                if not mk:
                    return self._json(503, {"error": "META_MODEL_API_KEY manquante côté serveur (.env)."})
                out = chat(META_URL, mk, model, body.get("messages") or [], max_tokens=int(body.get("max_tokens", 900)))
                out["provider"] = "meta-model-api"
                return self._json(200, out)
            return self._json(404, {"error": "not found"})
        except urllib.error.HTTPError as e:
            return self._json(e.code, {"error": e.read().decode()[:400]})
        except Exception as e:
            return self._json(500, {"error": str(e)[:400]})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"TWINFORGE server http://localhost:{port}  baseten={'oui' if os.environ.get('BASETEN_API_KEY') else 'non'} meta={'oui' if os.environ.get('META_MODEL_API_KEY') else 'non'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
