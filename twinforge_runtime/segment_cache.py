"""Content-addressed SAM responses. Reuse only matching provider receipts."""
import hashlib
import json
from pathlib import Path
from .providers import ModelClient, ProviderUnavailable


class CachedSegmentationClient:
    def __init__(self, directory, client=None, offline=False):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.client = client or ModelClient()
        self.offline = offline
        self.hits = self.misses = 0

    @property
    def ledger(self):
        return self.client.ledger

    @property
    def collection_mode(self):
        return 'verified_cache_only' if self.offline else 'live_provider_with_verified_cache'

    def segment(self, image_b64, concept, scene='hoop'):
        payload = {'model': 'sam-3.1', 'input': [{'role': 'user', 'content': [
            {'type': 'input_text', 'text': concept},
            {'type': 'input_image', 'image_url': 'data:image/jpeg;base64,' + image_b64}]}]}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        path = self.directory / (digest + '.json')
        if path.is_file():
            entry = json.loads(path.read_text())
            response = entry['response']
            checksum = hashlib.sha256(json.dumps(response, sort_keys=True).encode()).hexdigest()
            if entry.get('request_sha256') != digest or entry.get('response_sha256') != checksum or response.get('twinforge_receipt', {}).get('request_sha256') != digest:
                raise ValueError('SAM cache integrity check failed')
            self.hits += 1
            return response
        if self.offline:
            raise ProviderUnavailable('Verified SAM response missing from offline cache')
        self.misses += 1
        response = self.client.segment(image_b64, concept, scene)
        if response.get('twinforge_receipt', {}).get('request_sha256') != digest:
            raise ValueError('SAM response receipt does not match request')
        entry = {'request_sha256': digest, 'response_sha256': hashlib.sha256(json.dumps(response, sort_keys=True).encode()).hexdigest(), 'response': response}
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(entry))
        temporary.replace(path)
        return response
