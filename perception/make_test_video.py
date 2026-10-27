#!/usr/bin/env python3
"""Génère une vidéo de test droits-propres, cadrée sur la seule scène 3D TwinForge
pendant un tir complet (aucune footage tierce, aucun élément d'UI dans le champ).
Assemblée en MP4 à fps fixe depuis des captures du canvas WebGL en temps réel.

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
            # cadence temps réel approximative
            target = t0 + (i + 1) / FPS
            await page.wait_for_timeout(max(1, int((target - time.time()) * 1000)))
        writer.release()
        await browser.close()
    print(f"Vidéo de test : {DEST} ({os.path.getsize(DEST)//1024} Ko, {FPS} fps, {SECONDS}s, scène 3D seule)")


if __name__ == "__main__":
    asyncio.run(main())
