#!/usr/bin/env python3
"""Generate a rights-clean test video framed on the TwinForge 3D scene only
during one full shot (no third-party footage, no UI element in frame).
Assembled into an MP4 at fixed fps from real-time WebGL canvas captures.

Sortie : perception/test_shot.mp4
Usage  : PYTHONPATH=/tmp/w3d-pw:/tmp/samdeps python3 perception/make_test_video.py
"""
import asyncio
import os
import time

DEST = os.path.join(os.path.dirname(__file__), "test_shot.mp4")
PAGE = os.path.join(os.path.dirname(__file__), "..", "index.html")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FPS = 12
SECONDS = 8.0


async def main():
    import cv2
    import numpy as np
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=CHROME, args=["--headless=new", "--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1500, "height": 950})
        await page.goto("file://" + os.path.abspath(PAGE))
        await page.wait_for_timeout(2500)
        box = await page.evaluate("""() => { const c = document.querySelector('#scene-wrap canvas:not(#chart)');
            const r = c.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }""")
        clip = {"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]}
        await page.click("#btn-shoot")
        writer = None
        n = int(FPS * SECONDS)
        t0 = time.time()
        for i in range(n):
            shot = await page.screenshot(clip=clip, type="jpeg", quality=80)
            arr = cv2.imdecode(np.frombuffer(shot, dtype=np.uint8), cv2.IMREAD_COLOR)
            if writer is None:
                h, w = arr.shape[:2]
                writer = cv2.VideoWriter(DEST, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))
            writer.write(arr)
            # approximate real-time cadence
            target = t0 + (i + 1) / FPS
            await page.wait_for_timeout(max(1, int((target - time.time()) * 1000)))
        writer.release()
        await browser.close()
    print(f"Test video: {DEST} ({os.path.getsize(DEST)//1024} KB, {FPS} fps, {SECONDS}s, 3D scene only)")


if __name__ == "__main__":
    asyncio.run(main())
