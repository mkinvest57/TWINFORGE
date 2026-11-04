#!/usr/bin/env python3
"""Decode every frame and prepare contact sheets. Does not certify visual quality."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw


def inspect(video, output):
    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps: raise ValueError('No decodable video FPS')
    times = [3, 12, 22, 37, 46, 56, 69, 84, 99, 111, 124, 138, 146]
    wanted = {round(t*fps): t for t in times}
    samples = []; count = 0; blank = []; captions_absent = []
    while True:
        ok, frame = capture.read()
        if not ok: break
        if np.std(frame[65:610, :950]) < 1: blank.append(count)
        # Text should contain bright pixels; this cannot verify wording or legibility.
        if np.count_nonzero(np.min(frame[620:715], axis=2) > 160) < 10: captions_absent.append(count)
        if count in wanted:
            samples.append((wanted[count], Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))))
        count += 1
    capture.release()
    if not count: raise ValueError('No frames decoded')
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGB', (1280, ((len(samples)+1)//2)*390), '#111318')
    draw = ImageDraw.Draw(sheet)
    for i, (second, image) in enumerate(samples):
        image.thumbnail((640, 360)); x, y = (i%2)*640, (i//2)*390
        sheet.paste(image, (x, y)); draw.text((x+10, y+365), 't=%ss' % second, fill='white')
    contact = output.with_suffix('.jpg'); sheet.save(contact, quality=88)
    for name, index in [('demo', 3), ('mpc', 8)]:
        samples[index][1].save(output.with_name(name+'-current-preview.png'))
    result = {'schema_version': 'twinforge.media_decode.v1', 'checked_at': datetime.now(timezone.utc).isoformat(),
              'video': str(video), 'sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
              'fps': fps, 'decoded_frames': count, 'duration_seconds': count/fps,
              'blank_render_frame_ids': blank, 'absent_caption_pixel_frame_ids': captions_absent,
              'sample_times_seconds': [s for s, _ in samples], 'contact_sheet': str(contact),
              'visual_review_complete': False, 'full_watch': False,
              'limitations': ['Pixel checks detect blank regions, not semantic correctness.',
                              'Contact sheet still requires human/agent visual inspection.',
                              'No claim of reviewing every frame semantically.']}
    output.write_text(json.dumps(result, indent=2)+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect(args.video, args.out), indent=2))
