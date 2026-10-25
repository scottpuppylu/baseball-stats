"""Renders the site's HD backgrounds (assets/bg-*.webp): an orbital Earth limb for the home page and ball-flight
arcs over the horizon for player profiles, each in a landscape and a portrait (phone) crop.
Procedural and seeded, so no third-party photos are involved and the files can be rebuilt exactly:
    python scripts/build-backgrounds.py
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'assets'


def blurred_noise(rng, w, h, radius, scale=1):
    small = rng.random((max(2, h // scale), max(2, w // scale))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(radius))
    a = np.asarray(img, dtype=np.float32) / 255
    return (a - a.min()) / (a.max() - a.min() + 1e-6)


def stars(rng, w, h, count, img):
    ys, xs = rng.random(count) * h, rng.random(count) * w
    mags = rng.pareto(2.6, count) * 0.18 + 0.05
    tints = np.stack([1 - rng.random(count) * 0.12, 1 - rng.random(count) * 0.05, np.ones(count)], 1)
    yy, xx = np.mgrid[-3:4, -3:4]
    for x, y, m, t in zip(xs, ys, np.clip(mags, 0, 1.6), tints):
        sigma = 0.55 + min(m, 1) * 0.7
        psf = np.exp(-(xx ** 2 + yy ** 2) / (2 * sigma ** 2)) * m
        ix, iy = int(x), int(y)
        x0, x1, y0, y1 = max(ix - 3, 0), min(ix + 4, w), max(iy - 3, 0), min(iy + 4, h)
        if x0 >= x1 or y0 >= y1:
            continue
        p = psf[y0 - iy + 3:y1 - iy + 3, x0 - ix + 3:x1 - ix + 3]
        img[y0:y1, x0:x1] += p[..., None] * t


def earth(rng, w, h, cx, cy, r, img, sun_x, glow=(0.36, 0.72, 1.0), city=True):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) - r  # <0 inside the planet
    inside = d < 0
    # Night-side surface: deep navy with faint cloud structure, darker away from the rim.
    clouds = blurred_noise(rng, w, h, 18, 6) * 0.6 + blurred_noise(rng, w, h, 5, 2) * 0.4
    depth = np.clip(-d / (h * 0.5), 0, 1)
    surface = np.stack([0.010 + clouds * 0.020, 0.018 + clouds * 0.030, 0.040 + clouds * 0.055], -1) * (1 - depth[..., None] * 0.7)
    img[inside] = img[inside] * 0.0 + surface[inside]
    if city:
        n = int(w * h / 900)
        cxs, cys = rng.random(n) * w, rng.random(n) * h
        clusters = blurred_noise(rng, w, h, 30, 8)
        for x, y in zip(cxs.astype(int), cys.astype(int)):
            if d[y, x] < -6 and clusters[y, x] > 0.55 and rng.random() < 0.5:
                b = (clusters[y, x] - 0.5) * 0.9 * (1 - depth[y, x])
                img[y, x] += np.array([1.0, 0.72, 0.38]) * b
    # Atmosphere: a thin bright line at the limb and a soft blue haze above it, strongest toward the sun.
    sun = np.exp(-((xx - sun_x) / (w * 0.45)) ** 2)
    line = np.exp(-np.abs(d) / 2.2) * (0.55 + 0.9 * sun)
    haze = np.exp(-np.clip(d, 0, None) / (h * 0.045)) * (d > -2) * (0.18 + 0.55 * sun)
    inner = np.exp(np.clip(d, None, 0) / 14) * inside * (0.10 + 0.35 * sun)
    g = np.array(glow, dtype=np.float32)
    img += (line[..., None] * (g * 0.6 + 0.4)) + haze[..., None] * g * 0.55 + inner[..., None] * g * 0.5
    # Sunrise bloom on the limb.
    sy = cy - math.sqrt(max(r ** 2 - (sun_x - cx) ** 2, 0))
    bloom = np.exp(-(((xx - sun_x) / (w * 0.10)) ** 2 + ((yy - sy) / (h * 0.06)) ** 2))
    img += bloom[..., None] * np.array([1.0, 0.86, 0.66]) * 0.55
    return d


def arcs(rng, w, h, img, horizon_y, colour):
    # Ball-flight / launch arcs: thin glowing parabolas rising from the horizon.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for k in range(5):
        x0 = w * (0.12 + 0.17 * k + rng.random() * 0.05)
        span = w * (0.35 + rng.random() * 0.25)
        peak = h * (0.22 + rng.random() * 0.3)
        t = (xx - x0) / span
        yc = horizon_y - peak * 4 * t * (1 - t)
        dist = np.abs(yy - yc)
        on = (t > 0) & (t < 1)
        fade = np.clip(np.sin(np.clip(t, 0, 1) * math.pi), 0, 1) ** 0.6
        glow = (np.exp(-dist / 1.1) * 0.7 + np.exp(-dist / 9) * 0.12) * on * fade * (0.55 + 0.45 * (k % 2))
        img += glow[..., None] * np.array(colour)


def finish(img, rng, path, quality=82):
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    vign = 1 - 0.38 * (((xx - w / 2) / (w * 0.75)) ** 2 + ((yy - h / 2) / (h * 0.9)) ** 2)
    img *= np.clip(vign, 0.45, 1)[..., None]
    img = 1 - np.exp(-img * 1.6)  # soft filmic roll-off, no clipped whites
    img += (rng.random(img.shape[:2]) - 0.5)[..., None] * (2.2 / 255)  # grain against banding
    out = Image.fromarray((np.clip(img, 0, 1) ** (1 / 1.1) * 255).astype(np.uint8))
    out.save(path, 'WEBP', quality=quality, method=6)
    print(path.name, out.size, path.stat().st_size // 1024, 'KB')


def space(rng, w, h):
    img = np.zeros((h, w, 3), np.float32) + np.array([0.010, 0.012, 0.018], np.float32)
    band = blurred_noise(rng, w, h, 60, 10) * blurred_noise(rng, w, h, 20, 4)
    img += band[..., None] * np.array([0.05, 0.06, 0.09]) * 0.8
    stars(rng, w, h, int(w * h / 1400), img)
    return img


def orbit(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = (w * 2.6) if not portrait else (w * 3.4)
    cx, horizon = w * 0.42, h * (0.78 if not portrait else 0.6)
    earth(rng, w, h, cx, horizon + r, r, img, sun_x=w * (0.82 if not portrait else 0.76))
    return img, rng


def profile(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.2 if not portrait else 3.0)
    horizon = h * (0.86 if not portrait else 0.46)
    earth(rng, w, h, w * 0.55, horizon + r, r, img, sun_x=w * 0.22, glow=(0.30, 0.85, 0.80), city=False)
    arcs(rng, w, h, img, horizon, (0.95, 0.78, 0.45))
    return img, rng


def main():
    OUT.mkdir(exist_ok=True)
    for name, fn, size, portrait in [
        ('bg-orbit.webp', orbit, (2560, 1440), False), ('bg-orbit-portrait.webp', orbit, (1290, 2400), True),
        ('bg-profile.webp', profile, (2400, 1200), False), ('bg-profile-portrait.webp', profile, (1290, 2000), True),
    ]:
        img, rng = fn(*size, seed=20261026 + len(name), portrait=portrait)
        finish(img, rng, OUT / name)


if __name__ == '__main__':
    main()
