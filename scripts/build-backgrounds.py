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


# ---------- Premium planets (2026/10/26, v2): textures live on the sphere, lighting reads surface relief ----------
def _hash3(xi, yi, zi, seed):
    h = (xi.astype(np.uint32) * np.uint32(73856093)) ^ (yi.astype(np.uint32) * np.uint32(19349663)) ^ (zi.astype(np.uint32) * np.uint32(83492791)) ^ np.uint32(seed)
    h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h = h ^ (h >> np.uint32(16))
    return (h & np.uint32(0xFFFF)).astype(np.float32) / 65535.0


def vnoise3(x, y, z, seed=0):
    """Smooth 3D value noise in 0..1 (quintic interpolation)."""
    xf, yf, zf = np.floor(x), np.floor(y), np.floor(z)
    tx, ty, tz = x - xf, y - yf, z - zf
    sx, sy, sz = (t * t * t * (t * (t * 6 - 15) + 10) for t in (tx, ty, tz))
    xi, yi, zi = xf.astype(np.int64), yf.astype(np.int64), zf.astype(np.int64)
    def c(dx, dy, dz):
        return _hash3(xi + dx, yi + dy, zi + dz, seed)
    x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * sx
    x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * sx
    x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * sx
    x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * sx
    y0 = x00 + (x10 - x00) * sy
    y1 = x01 + (x11 - x01) * sy
    return y0 + (y1 - y0) * sz


def fbm3(x, y, z, octaves=6, freq=1.0, gain=.5, seed=0):
    total, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        total = total + vnoise3(x * freq, y * freq, z * freq, seed + o * 101) * amp
        norm += amp
        amp *= gain
        freq *= 2.03
    return total / norm


def sphere_points(w, h, cx, cy, r, margin=4):
    """Pixels covered by the disk (cropped to the image): indices and unit-sphere coordinates (z toward the viewer)."""
    x0, x1 = max(0, int(cx - r - margin)), min(w, int(cx + r + margin) + 1)
    y0, y1 = max(0, int(cy - r - margin)), min(h, int(cy + r + margin) + 1)
    if x0 >= x1 or y0 >= y1:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    u, v = (xx + .5 - cx) / r, (yy + .5 - cy) / r
    rr = u * u + v * v
    return (y0, y1, x0, x1), u, v, rr


def render_planet(img, cx, cy, r, light, surface, bump=0.0, limb_dark=0.0, atmosphere=None, night=None, aa=1.2):
    """surface(px, py, pz) -> (albedo HxWx3, height HxW or None) on the unit sphere (y up is screen up).
    Lambert lighting with a soft terminator, bump from the height field, optional limb darkening, night lights
    and a scattering halo. Antialiased edge."""
    h, w, _ = img.shape
    res = sphere_points(w, h, cx, cy, r, margin=int(r * .02) + 6)
    if res is None:
        return
    (y0, y1, x0, x1), u, v, rr = res
    inside = rr < 1
    z = np.sqrt(np.clip(1 - rr, 0, 1))
    px, py, pz = u, -v, z  # sphere point (unit)
    lx, ly, lz = light
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / ln, ly / ln, lz / ln
    albedo, height = surface(px, py, pz)
    ndl = px * lx + py * ly + pz * lz
    if height is not None and bump:
        # Screen-space bump: relief along the light's screen direction brightens slopes facing it.
        gx = np.zeros_like(height); gy = np.zeros_like(height)
        gx[:, 1:-1] = (height[:, 2:] - height[:, :-2]) * .5
        gy[1:-1, :] = (height[2:, :] - height[:-2, :]) * .5
        ndl = ndl + bump * (gx * lx - gy * ly) * 40  # height in 0..1 per pixel: size-independent strength
    shade = np.clip((ndl + .06) / 1.06, 0, 1) ** .9
    shade = shade * shade * (3 - 2 * shade) * .35 + shade * .65  # soft terminator
    if limb_dark:
        shade = shade * (np.clip(z, 0, 1) ** limb_dark)
    col = albedo * shade[..., None]
    if night is not None:
        dark = np.clip(-ndl * 3, 0, 1)
        col = col + night(px, py, pz) * dark[..., None]
    edge = np.clip((1 - np.sqrt(rr)) * r / aa + .5, 0, 1)  # antialiased limb
    region = img[y0:y1, x0:x1]
    region[:] = region * (1 - edge[..., None]) + col * edge[..., None]
    if atmosphere is not None:
        colour, thickness, strength = atmosphere
        d = (np.sqrt(rr) - 1) * r  # >0 outside
        lit = np.clip((u * lx - v * ly) / max(1e-3, math.hypot(lx, ly)) * .6 + .55, 0, 1) if math.hypot(lx, ly) > 1e-3 else 1.0
        halo = np.where(d > 0, np.exp(-np.clip(d, 0, None) / thickness), np.exp(np.clip(d, None, 0) / (thickness * .6)) * .7) * lit * strength
        rim = np.exp(-np.abs(d) / 1.6) * lit * strength * .8
        region += (halo + rim)[..., None] * np.array(colour, np.float32)


def earth_v2(img, cx, cy, r, light, city=True, cloud_scale=1.0, seed=7):
    """Night-side Earth seen near the limb: dark oceans and land, thin clouds, warm city lights, blue scattering rim."""
    f = r / 260.0 * cloud_scale  # feature size ~260 px of arc
    def surface(px, py, pz):
        land = fbm3(px * f, py * f, pz * f, 5, 1.0, .55, seed) > .52
        clouds = np.clip((fbm3(px * f * 1.7, py * f * 1.7, pz * f * 1.7, 6, 1.0, .55, seed + 9) - .48) * 2.4, 0, 1)
        base = np.where(land[..., None], np.array([.035, .045, .035], np.float32), np.array([.015, .03, .06], np.float32))
        alb = base * (1 - clouds[..., None]) + clouds[..., None] * np.array([.55, .6, .66], np.float32) * .55
        return alb, clouds * .6
    def night(px, py, pz):
        if not city:
            return np.zeros(px.shape + (3,), np.float32)
        n = fbm3(px * f * 4, py * f * 4, pz * f * 4, 4, 1.0, .6, seed + 21)
        land = fbm3(px * f, py * f, pz * f, 5, 1.0, .55, seed) > .52
        lights = np.clip((n - .62) * 6, 0, 1) ** 2 * land
        return lights[..., None] * np.array([1.0, .72, .38], np.float32) * .7
    render_planet(img, cx, cy, r, light, surface, bump=.6, night=night, atmosphere=((.35, .65, 1.0), max(8, r * .006), 1.0))


def mars_v2(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.2 if not portrait else 3.0)
    horizon = h * (.74 if not portrait else .62)
    f = r / 220.0
    def surface(px, py, pz):
        base = fbm3(px * f, py * f, pz * f, 7, 1.0, .52, seed)
        dark = np.clip((fbm3(px * f * .35, py * f * .35, pz * f * .35, 4, 1.0, .5, seed + 5) - .45) * 2.2, 0, 1)
        dunes = fbm3(px * f * 6, py * f * 6, pz * f * 6, 4, 1.0, .5, seed + 9)
        alb = np.stack([.62 + base * .28, .28 + base * .14, .14 + base * .06], -1) * (1 - dark[..., None] * .45)
        return alb * .62, base * .55 + dunes * .2
    render_planet(img, w * .5, horizon + r, r, (.75, .35, .28), surface, bump=1.1, atmosphere=((1.0, .66, .42), max(8, r * .005), .75))
    glow(img, w * .82, horizon - h * .01, min(w, h) * .05, (1.0, .86, .66), .5)
    return img, rng


def moon_v2(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.4 if not portrait else 3.2)
    horizon = h * (.76 if not portrait else .66)
    cx, cy = w * .45, horizon + r
    f = r / 200.0
    # Craters as (centre on the sphere, angular radius), concentrated on the visible cap.
    craters = []
    for _ in range(150):
        sx = (rng.random() - .5) * (w * 1.1) / r
        sy = -(horizon + h * .04 + rng.random() * (h - horizon) * 1.05 - cy) / r
        sz = math.sqrt(max(0, 1 - sx * sx - sy * sy))
        craters.append((sx, sy, sz, (4 + rng.random() ** 4 * 55) / r))
    def surface(px, py, pz):
        maria = np.clip((fbm3(px * f * .3, py * f * .3, pz * f * .3, 4, 1.0, .5, seed) - .5) * 2.5, 0, 1)
        grit = fbm3(px * f * 3, py * f * 3, pz * f * 3, 6, 1.0, .55, seed + 3)
        fade = np.clip(pz / .08, 0, 1) ** .8  # detail fades toward the grazing horizon (no shimmer)
        height = grit * .22 * fade
        for (sx, sy, sz, ar) in craters:
            d = np.arccos(np.clip(px * sx + py * sy + pz * sz, -1, 1)) / ar
            near = d < 1.6
            if not near.any():
                continue
            bowl = np.where(d < 1, (d * d - 1) * .16, 0)
            rim = np.exp(-((d - 1) / .2) ** 2) * .07 + np.where(d > 1, np.exp(-(d - 1) * 3) * .02, 0)
            height = height + (bowl + rim) * near * fade
        g = (.30 + grit * .14) * (1 - maria * .38)
        alb = np.stack([g, g * .985, g * .96], -1) * .72
        return alb, height
    render_planet(img, cx, cy, r, (-.82, .25, .3), surface, bump=1.6, atmosphere=None)
    # Earthrise
    er = min(w, h) * (.05 if not portrait else .085)
    ex, ey = (w * .74, horizon - h * .17) if not portrait else (w * .7, horizon - h * .13)
    fe = er / 22.0
    def esurf(px, py, pz):
        land = fbm3(px * fe + 3, py * fe, pz * fe, 5, 1.0, .55, seed + 40) > .55
        clouds = np.clip((fbm3(px * fe * 2, py * fe * 2, pz * fe * 2, 6, 1.0, .55, seed + 41) - .45) * 2.2, 0, 1)
        base = np.where(land[..., None], np.array([.16, .2, .1], np.float32), np.array([.04, .14, .36], np.float32))
        return base * (1 - clouds[..., None]) + clouds[..., None] * .82, None
    render_planet(img, ex, ey, er, (-.82, .25, .3), esurf, atmosphere=((.4, .65, 1.0), max(2, er * .06), .9))
    return img, rng


def jupiter_v2(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = h * .82 if not portrait else w * .78
    cx, cy = (w * .12, h * 1.05) if not portrait else (w * .5, h * 1.08)
    def surface(px, py, pz):
        lat = np.arcsin(np.clip(py, -1, 1))
        warp = (fbm3(px * 3, py * 3, pz * 3, 6, 1.0, .55, seed) - .5) * .22 + (fbm3(px * 9, py * 9, pz * 9, 4, 1.0, .5, seed + 2) - .5) * .05
        L = lat + warp
        b = .5 + .5 * np.tanh(np.sin(L * 14) * 2.4)  # crisp zones and belts
        c = .5 + .5 * np.tanh(np.sin(L * 5 + 1.1) * 1.6)
        fine = np.sin(L * 60 + fbm3(px * 14, py * 14, pz * 14, 3, 1.0, .5, seed + 4) * 6) * .5 + .5
        col = np.stack([.72 + .24 * b - .18 * c + .06 * fine, .58 + .15 * b - .15 * c + .04 * fine, .42 + .07 * b - .1 * c], -1)
        # Great Red Spot near -22° latitude, a swirled oval.
        lon = np.arctan2(px, pz)
        dl, dla = (lon - .3) / .14, (lat - .36) / .06
        spot = np.exp(-(dl * dl + dla * dla) ** 1.2)
        col = col * (1 - spot[..., None] * .5) + spot[..., None] * np.array([.78, .38, .26], np.float32)
        return col * .5, b * .3 + fine * .1
    render_planet(img, cx, cy, r, (.45, .6, .65), surface, bump=.6, limb_dark=.45, atmosphere=((.9, .8, .65), max(6, r * .004), .35))
    return img, rng


def saturn_v2(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    cx, cy = (w * .7, h * .38) if not portrait else (w * .55, h * .26)
    r = min(w, h) * (.2 if not portrait else .19)
    tilt, ang = .27, math.radians(-16)
    light = (-.75, .25, .6)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rx = (xx - cx) * math.cos(ang) + (yy - cy) * math.sin(ang)
    ry = -(xx - cx) * math.sin(ang) + (yy - cy) * math.cos(ang)
    rd = np.sqrt(rx ** 2 + (ry / tilt) ** 2) / r
    # Ring radial profile: C ring faint, B ring bright, Cassini division, A ring with the Encke gap; fine ringlets.
    ringlets = np.interp(rd, np.linspace(1.1, 2.4, 2048), fbm(np.random.default_rng(seed + 1), 2048, 2, 4, 2)[0])
    prof = (np.clip((rd - 1.24) / .02, 0, 1) * np.clip((1.53 - rd) / .02, 0, 1) * .28  # C
            + np.clip((rd - 1.53) / .01, 0, 1) * np.clip((1.95 - rd) / .01, 0, 1) * .95  # B
            + np.clip((rd - 2.03) / .01, 0, 1) * np.clip((2.27 - rd) / .01, 0, 1) * .7)  # A
    prof *= (1 - np.exp(-((rd - 2.21) / .006) ** 2) * .9)  # Encke gap
    prof *= (.7 + .3 * ringlets)
    ring_col = np.array([.78, .7, .56], np.float32) * prof[..., None] * .82
    # The planet's shadow on the far side of the rings (cast away from the light).
    sh = np.clip(1 - np.exp(-((rx - (-light[0]) * r * 1.6) ** 2 / (r * .9) ** 2 + (ry / tilt - r * .2) ** 2 / (r * 1.1) ** 2) * 3), .25, 1)
    behind = ry < 0
    img += np.where(behind[..., None], ring_col * sh[..., None] * .85, 0)
    def surface(px, py, pz):
        lat = np.arcsin(np.clip(py, -1, 1))
        L = lat + (fbm3(px * 4, py * 4, pz * 4, 5, 1.0, .5, seed) - .5) * .06
        b = np.sin(L * 18) * .5 + .5
        c = np.sin(L * 6 + .7) * .5 + .5
        col = np.stack([.76 + .08 * b - .06 * c, .66 + .07 * b - .05 * c, .48 + .04 * b], -1)
        return col * .6, None
    # Ring shadow band across the planet's lit face.
    render_planet(img, cx, cy, r, light, surface, limb_dark=.35, atmosphere=((.9, .85, .7), max(3, r * .01), .25))
    band = np.exp(-((ry - r * .16) / (r * .07)) ** 2) * (np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) < r)
    img *= (1 - band[..., None] * .45)
    front = ~behind
    over_planet = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) < r
    img = np.where(front[..., None], img * (1 - prof[..., None] * .55) + ring_col, img)
    return img, rng


def orbit_v2(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = (w * 2.6) if not portrait else (w * 3.4)
    cx, horizon = w * .42, h * (.78 if not portrait else .6)
    sun_x = w * (.82 if not portrait else .76)
    earth_v2(img, cx, horizon + r, r, (.55, .18, -.05))
    sy = horizon + r - math.sqrt(max(r ** 2 - (sun_x - cx) ** 2, 0))
    glow(img, sun_x, sy, min(w, h) * .045, (1.0, .9, .72), .65)
    return img, rng


def profile_v2(w, h, seed, portrait):
    rng = np.random.default_rng(seed)
    img = space(rng, w, h)
    r = w * (2.2 if not portrait else 3.0)
    horizon = h * (.86 if not portrait else .46)
    earth_v2(img, w * .55, horizon + r, r, (-.6, .2, -.05), city=False, seed=11)
    arcs(rng, w, h, img, horizon, (0.95, 0.78, 0.45))
    return img, rng


def aurora_v2(w, h, seed, portrait):
    img, rng = aurora(w, h, seed, portrait)  # curtains from the first version
    r = w * (2.4 if not portrait else 3.2)
    horizon = h * (.72 if not portrait else .64)
    # Repaint the planet with the sphere renderer underneath the curtains' base.
    base = np.zeros_like(img)
    earth_v2(base, w * .5, horizon + r, r, (0, -.2, -1), city=True, seed=13)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    inside = np.sqrt((xx - w * .5) ** 2 + (yy - horizon - r) ** 2) < r - 2
    img = np.where(inside[..., None], base + img * .15, img)
    return img, rng


PAGE_SCENES = [('overview', milkyway), ('analytics', nebula), ('pitching', mars_v2), ('records', saturn_v2), ('leaderboard', moon_v2),
               ('compare', binary), ('health', aurora_v2), ('lineup', jupiter_v2), ('glossary', galaxy), ('changelog', comet)]


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
        ('bg-orbit.webp', orbit_v2, (2560, 1440), False), ('bg-orbit-portrait.webp', orbit_v2, (1290, 2400), True),
        ('bg-profile.webp', profile_v2, (2560, 1440), False), ('bg-profile-portrait.webp', profile_v2, (1290, 2400), True),
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
