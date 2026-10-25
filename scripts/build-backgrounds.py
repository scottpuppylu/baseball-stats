"""Renders the site's HD backgrounds (assets/bg-*.webp), each in a landscape and a portrait (phone / portrait tablet) crop:
an orbital Earth limb (home), ball-flight arcs over the horizon (player profiles) and one space scene per page
(Milky Way, nebula, Mars, Saturn, Moon with Earthrise, binary stars, aurora, Jupiter, spiral galaxy, comet).
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


# ---------- Page scenes (2026/10/26): one space theme per page ----------
def fbm(rng, w, h, octaves=5, base=6):
    """Fractal noise in 0..1 from blurred random fields at doubling resolution."""
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        scale = max(1, base * (2 ** (octaves - 1 - o)))
        out += blurred_noise(rng, w, h, max(1, scale // 2), scale) * amp
        total += amp
        amp *= .55
    out /= total
    return (out - out.min()) / (out.max() - out.min() + 1e-6)


def glow(img, x, y, radius, colour, strength=1.0):
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
    img += (np.exp(-(d / radius) ** 2) * .9 + np.exp(-d / (radius * 3)) * .25)[..., None] * np.array(colour, np.float32) * strength


def spikes(img, x, y, length, colour, strength=.5, angles=(0, 90)):
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for a in angles:
        t = math.radians(a)
        along = (xx - x) * math.cos(t) + (yy - y) * math.sin(t)
        across = -(xx - x) * math.sin(t) + (yy - y) * math.cos(t)
        img += (np.exp(-np.abs(across) / 1.2) * np.exp(-np.abs(along) / length))[..., None] * np.array(colour, np.float32) * strength


def milkyway(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 3), np.float32) + np.array([.008, .009, .014], np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # A diagonal band; across it a soft profile, along it brighter toward the core.
    ang = math.radians(-28 if not portrait else -62)
    cx, cy = w * .55, h * .45
    across = -(xx - cx) * math.sin(ang) + (yy - cy) * math.cos(ang)
    along = (xx - cx) * math.cos(ang) + (yy - cy) * math.sin(ang)
    width = min(w, h) * .2
    band = np.exp(-(across / width) ** 2) * (.55 + .45 * np.exp(-(along / (max(w, h) * .38)) ** 2))
    n = fbm(rng, w, h, 6, 4)
    dust = fbm(rng, w, h, 5, 3)
    lane = np.clip(1 - 1.6 * np.exp(-(across / (width * .28)) ** 2) * (dust > .45) * (dust - .45) * 3, 0, 1)
    density = band * (.35 + .65 * n) * lane
    core = np.exp(-((along / (max(w, h) * .2)) ** 2 + (across / (width * .6)) ** 2))
    img += density[..., None] * np.array([.16, .15, .17]) + (core * lane)[..., None] * np.array([.22, .16, .09])
    img += (band * (1 - n) * .05)[..., None] * np.array([.2, .3, .6])
    stars(rng, w, h, int(w * h / 1600), img)
    # Extra faint stars inside the band.
    sel = rng.random((h, w)) < density * .02
    img[sel] += .35
    return img, rng


def nebula(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    a, b, c = fbm(rng, w, h, 6, 5), fbm(rng, w, h, 6, 4), fbm(rng, w, h, 5, 6)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    focus = np.exp(-(((xx - w * (.66 if not portrait else .5)) / (w * .45)) ** 2 + ((yy - h * (.36 if not portrait else .3)) / (h * .42)) ** 2))
    teal = np.clip(a - .42, 0, 1) ** 1.4 * focus * 1.9
    magenta = np.clip(b - .48, 0, 1) ** 1.3 * focus * 2.1
    gold = np.clip(c - .62, 0, 1) ** 1.2 * focus * 1.6
    voids = np.clip(1 - np.clip(c - .5, 0, 1) * 1.6, .35, 1)
    img += (teal[..., None] * np.array([.12, .5, .52]) + magenta[..., None] * np.array([.55, .14, .42]) + gold[..., None] * np.array([.6, .42, .16])) * voids[..., None]
    for _ in range(6):
        glow(img, rng.random() * w, rng.random() * h * .8, 3 + rng.random() * 3, (.9, .92, 1), .5)
    return img, rng


def planet_disk(img, cx, cy, r, colour_fn, light=(-.6, -.5), ring_shadow=None):
    """Shades a sphere: colour_fn(u, v) gives albedo on the disk; light from the given direction."""
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = (xx - cx) / r, (yy - cy) / r
    rr = u * u + v * v
    inside = rr < 1
    z = np.sqrt(np.clip(1 - rr, 0, 1))
    lx, ly = light
    lz = math.sqrt(max(0, 1 - lx * lx - ly * ly))
    shade = np.clip(u * lx + v * ly + z * lz, 0, 1) ** .8
    albedo = colour_fn(u, v)
    lit = albedo * (shade[..., None] * .95 + .02)
    if ring_shadow is not None:
        lit *= ring_shadow[..., None]
    img[inside] = lit[inside]
    # Thin atmosphere rim on the lit side.
    rim = np.exp(-np.abs(np.sqrt(rr) - 1) * r / 2.5) * np.clip(u * lx + v * ly + .3, 0, 1)
    img += rim[..., None] * np.array([.5, .55, .6]) * .25
    return inside


def mars(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.2 if not portrait else 3.0)
    horizon = h * (.74 if not portrait else .62)
    tex = fbm(rng, w, h, 6, 3)
    d = earth(rng, w, h, w * .5, horizon + r, r, img, sun_x=w * .78, glow=(1.0, .62, .38), city=False)
    inside = d < 0
    depth = np.clip(-d / (h * .5), 0, 1)
    surface = np.stack([.30 + tex * .22, .11 + tex * .08, .06 + tex * .04], -1) * (1 - depth[..., None] * .82) * (.35 + .65 * np.exp(np.clip(d, None, 0) / (h * .12)))[..., None]
    img[inside] = surface[inside]
    return img, rng


def saturn(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    cx, cy = (w * .7, h * .38) if not portrait else (w * .55, h * .26)
    r = min(w, h) * (.2 if not portrait else .19)
    tilt = .28
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # Rings: an ellipse annulus with bands and the Cassini gap.
    ang = math.radians(-16)
    rx = (xx - cx) * math.cos(ang) + (yy - cy) * math.sin(ang)
    ry = -(xx - cx) * math.sin(ang) + (yy - cy) * math.cos(ang)
    rd = np.sqrt(rx ** 2 + (ry / tilt) ** 2) / r
    ring = ((rd > 1.25) & (rd < 2.25)).astype(np.float32)
    bands = .55 + .45 * np.sin(rd * 46) * np.sin(rd * 13 + 1)
    gap = 1 - np.exp(-((rd - 1.86) / .03) ** 2)
    ringc = (ring * bands * gap * np.clip((2.25 - rd) * 3, 0, 1))[..., None] * np.array([.62, .55, .42])
    back = ry < 0
    img += np.where(back[..., None], ringc * .85, 0)
    shadow = np.where((ry > 0) & (np.abs(rx) < r * 1.1) & (ry < r * .55), .45, 1.0)
    planet_disk(img, cx, cy, r, lambda u, v: np.stack([.62 + .1 * np.sin(v * 18), .52 + .08 * np.sin(v * 18 + .5), .36 + .05 * np.sin(v * 21)], -1), light=(-.7, -.35), ring_shadow=shadow)
    front = ry >= 0
    pr = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) < r
    img += np.where((front & ~pr)[..., None], ringc, 0) + np.where((front & pr)[..., None], ringc * .9, 0)
    return img, rng


def moon(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.4 if not portrait else 3.2)
    horizon = h * (.76 if not portrait else .66)
    cx, cy = w * .45, horizon + r
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) - r
    inside = d < 0
    tex = fbm(rng, w, h, 6, 2)
    craters = np.zeros((h, w), np.float32)
    for _ in range(220):
        x, y, cr = rng.random() * w, horizon + rng.random() * (h - horizon), 2 + rng.random() ** 3 * 46
        dd = np.sqrt((xx - x) ** 2 + ((yy - y) * 2.6) ** 2) / cr
        craters += (np.exp(-((dd - 1) / .35) ** 2) * .22 - np.exp(-(dd / .9) ** 3) * .18) * (.4 + rng.random() * .6)
    depth = np.clip(-d / (h * .4), 0, 1)
    grey = (.17 + tex * .12 + craters * .1) * (1 - depth * .8)
    img[inside] = np.stack([grey, grey * .98, grey * .95], -1)[inside]
    img += (np.exp(-np.abs(d) / 1.5) * .22)[..., None] * np.array([.9, .9, .9])
    # Earthrise: a small blue planet above the horizon.
    ex, ey, er = (w * .74, horizon - h * .18, min(w, h) * .055) if not portrait else (w * .7, horizon - h * .14, min(w, h) * .09)
    cl = fbm(rng, w, h, 4, 2)
    planet_disk(img, ex, ey, er, lambda u, v: np.stack([.12 + cl * .5, .28 + cl * .45, .55 + cl * .35], -1), light=(.75, -.2))
    return img, rng


def binary(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    n = fbm(rng, w, h, 5, 5)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    (ax, ay), (bx, by) = ((w * .38, h * .34), (w * .66, h * .44)) if not portrait else ((w * .34, h * .26), (w * .7, h * .36))
    # A faint stream of gas between the pair.
    t = np.clip(((xx - ax) * (bx - ax) + (yy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1)
    px, py = ax + t * (bx - ax), ay + t * (by - ay) + np.sin(t * math.pi) * h * .04
    dist = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)
    img += (np.exp(-dist / (min(w, h) * .05)) * (.4 + .6 * n) * .35)[..., None] * np.array([.55, .45, .7])
    glow(img, ax, ay, min(w, h) * .02, (.75, .85, 1.0), 1.4)
    glow(img, bx, by, min(w, h) * .015, (1.0, .72, .42), 1.2)
    spikes(img, ax, ay, min(w, h) * .18, (.7, .8, 1), .5, (0, 90))
    spikes(img, bx, by, min(w, h) * .12, (1, .8, .6), .4, (0, 90))
    return img, rng


def aurora(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.4 if not portrait else 3.2)
    horizon = h * (.72 if not portrait else .64)
    d = earth(rng, w, h, w * .5, horizon + r, r, img, sun_x=w * 1.4, glow=(.3, .6, 1.0), city=True)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    streak = blurred_noise(rng, w, h, 2, 1)
    streak = Image.fromarray((streak * 255).astype(np.uint8)).resize((w, max(2, h // 40)), Image.BILINEAR).resize((w, h), Image.BICUBIC)
    streak = np.asarray(streak, np.float32) / 255
    wave = np.sin(xx / w * 9 + fbm(rng, w, h, 4, 8) * 4) * h * .03
    above = np.clip(-(d + wave * 0), 0, None)
    height = np.clip(d + wave, 0, None)
    curtain = np.exp(-height / (h * .09)) * (d > -2) * (.3 + streak * 1.2) * (.4 + .6 * fbm(rng, w, h, 4, 10))
    top = np.exp(-height / (h * .2)) * (d > -2) * .3
    img += curtain[..., None] * np.array([.18, .85, .5]) * .9 + (top * streak)[..., None] * np.array([.5, .25, .6])
    return img, rng


def jupiter(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    cx, cy = (w * .3, h * 1.62) if not portrait else (w * .5, h * 1.3)
    r = h * .95 if not portrait else w * 1.05
    turb = fbm(rng, w, h, 5, 6)

    def bands(u, v):
        vv = v + (turb[:, :] - .5) * .08
        b = np.sin(vv * 26) * .5 + .5
        c = np.sin(vv * 9 + 1.3) * .5 + .5
        col = np.stack([.62 + .2 * b - .1 * c, .5 + .12 * b - .08 * c, .38 + .05 * b], -1) * .55
        # Great Red Spot
        spot = np.exp(-(((u - .3) / .1) ** 2 + ((v + .82) / .035) ** 2))
        col = col * (1 - spot[..., None] * .4) + spot[..., None] * np.array([.42, .18, .11])
        return col
    planet_disk(img, cx, cy, r, bands, light=(.55, -.65))
    return img, rng


def galaxy(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    cx, cy = (w * .66, h * .36) if not portrait else (w * .55, h * .3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ang = math.radians(-24)
    x1 = (xx - cx) * math.cos(ang) + (yy - cy) * math.sin(ang)
    y1 = (-(xx - cx) * math.sin(ang) + (yy - cy) * math.cos(ang)) / .42
    rad = np.sqrt(x1 ** 2 + y1 ** 2) / (min(w, h) * .32)
    theta = np.arctan2(y1, x1)
    arms = (np.cos(2 * (theta - np.log(rad + 1e-3) * 2.4)) * .5 + .5) ** 3
    n = fbm(rng, w, h, 5, 3)
    disk = np.exp(-rad * 2.2) * (.25 + .75 * arms * (.5 + .5 * n))
    core = np.exp(-(rad / .12) ** 2)
    img += disk[..., None] * np.array([.42, .46, .62]) * 1.1 + core[..., None] * np.array([.95, .82, .6])
    dust = np.clip(n - .55, 0, 1) * arms * np.exp(-rad * 1.5)
    img *= (1 - dust[..., None] * 1.2).clip(.3, 1)
    return img, rng


def comet(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    hx, hy = (w * .72, h * .3) if not portrait else (w * .66, h * .24)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ang = math.radians(200 if not portrait else 228)  # tail points away from the (off-screen) sun
    along = (xx - hx) * math.cos(ang) + (yy - hy) * math.sin(ang)
    across = -(xx - hx) * math.sin(ang) + (yy - hy) * math.cos(ang)
    L = max(w, h) * .7
    ion = (along > 0) * np.exp(-along / L) * np.exp(-(across / (8 + along * .03)) ** 2)
    curve = across - (along ** 2) / (L * 2.2)
    dust = (along > 0) * np.exp(-along / (L * .7)) * np.exp(-(curve / (14 + along * .09)) ** 2)
    streaks = blurred_noise(rng, w, h, 1, 1)
    img += ion[..., None] * np.array([.35, .6, 1.0]) * (.7 + .3 * streaks[..., None]) + dust[..., None] * np.array([.9, .75, .5]) * .6
    glow(img, hx, hy, min(w, h) * .012, (1, .97, .9), 1.6)
    return img, rng


PAGE_SCENES = [('overview', milkyway), ('analytics', nebula), ('pitching', mars), ('records', saturn), ('leaderboard', moon),
               ('compare', binary), ('health', aurora), ('lineup', jupiter), ('glossary', galaxy), ('changelog', comet)]


def build_pages(only=None):
    for i, (name, fn) in enumerate(PAGE_SCENES):
        if only and name not in only:
            continue
        for portrait, size in [(False, (2560, 1440)), (True, (1290, 2400))]:
            img, rng = fn(*size, seed=4100 + i * 7 + portrait, portrait=portrait)
            finish(img, rng, OUT / f"bg-{name}{'-portrait' if portrait else ''}.webp")


def main():
    OUT.mkdir(exist_ok=True)
    for name, fn, size, portrait in [
        ('bg-orbit.webp', orbit, (2560, 1440), False), ('bg-orbit-portrait.webp', orbit, (1290, 2400), True),
        ('bg-profile.webp', profile, (2400, 1200), False), ('bg-profile-portrait.webp', profile, (1290, 2000), True),
    ]:
        img, rng = fn(*size, seed=20261026 + len(name), portrait=portrait)
        finish(img, rng, OUT / name)
    build_pages()


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        build_pages(sys.argv[1:])  # e.g. python scripts/build-backgrounds.py saturn moon
    else:
        main()
