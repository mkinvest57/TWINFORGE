#!/usr/bin/env python3
"""Resume perception using verified provider responses, preserving the spend ledger."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from perception.sam_perception import main
from twinforge_runtime.segment_cache import CachedSegmentationClient

if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--cache-dir', required=True)
    parser.add_argument('--offline', action='store_true')
    args, remaining = parser.parse_known_args()
    client = CachedSegmentationClient(args.cache_dir, offline=args.offline)
    try:
        main(remaining, client=client)
    finally:
        print('Verified SAM cache: %d reused, %d live requests' % (client.hits, client.misses))
