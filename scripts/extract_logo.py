"""Recover the mark from a JPEG with the transparency checkerboard baked in.

The checkerboard is a carrier. Writing the two tones as MID +/- SWING and letting s(x,y)
be +1 on light squares and -1 on dark:

    C = A*F + (1 - A) * (MID + s*SWING)
      = [A*F + (1 - A)*MID]  +  s * (1 - A) * SWING
        \_____ smooth ______/     \___ modulated by s ___/

Multiplying by s and averaging over one full checker period isolates the second term,
because the smooth part multiplied by s averages to zero over equal light and dark area.
That yields the modulation amplitude, and therefore alpha, at every pixel — no threshold,
no guessing, and the mark's sharp pixels are left alone because the amplitude is ~0 there.
"""
import numpy as np
from PIL import Image

SRC = "Gemini_Generated_Image_bkf81kbkf81kbkf8.jpg"
img = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float64)
h, w, _ = img.shape

LIGHT, DARK = 90.0, 53.0
MID = (LIGHT + DARK) / 2
SWING = (LIGHT - DARK) / 2


def fit_period(line):
    is_light = line > MID
    edges = np.flatnonzero(is_light[:-1] != is_light[1:]) + 1
    return np.polyfit(np.arange(len(edges)), edges.astype(float), 1)


square, phase_x = fit_period(img[5, :, 0])
_, phase_y = fit_period(img[:200, 5, 0])
ys, xs = np.mgrid[0:h, 0:w]
parity = (np.floor((xs - phase_x) / square) + np.floor((ys - phase_y) / square)) % 2 == 0
if (img[5, 5, 0] > MID) != parity[5, 5]:
    parity = ~parity
sign = np.where(parity, 1.0, -1.0)


def box_blur(field, radius):
    """Separable box blur via cumulative sums."""
    out = field.astype(np.float64)
    for axis in (0, 1):
        pad_width = [(0, 0), (0, 0)]
        pad_width[axis] = (radius + 1, radius)
        cumulative = np.cumsum(np.pad(out, pad_width, mode="edge"), axis=axis)
        size = 2 * radius + 1
        out = (
            (cumulative[size:, :] - cumulative[:-size, :]) / size
            if axis == 0
            else (cumulative[:, size:] - cumulative[:, :-size]) / size
        )
    return out


# Two full periods, which isolates the carrier best on this image.
luma = img.mean(axis=2)
amplitude = box_blur(luma * sign, 2 * int(round(square)))

# amplitude = (1 - A) * SWING. Calibrate the swing from a corner known to be bare
# backdrop: JPEG compresses the tone contrast slightly, and using the nominal 18.5
# leaves a few percent of alpha everywhere, which reads as a grey haze.
measured_swing = float(np.median(amplitude[:150, :150]))
alpha = np.clip(1.0 - amplitude / measured_swing, 0.0, 1.0)
alpha[alpha < 0.03] = 0.0
print(f"swing: nominal {SWING:.2f} measured {measured_swing:.2f}")

# JPEG compresses the tone contrast unevenly across the frame, so a single calibrated
# swing still leaves a few percent of alpha in far corners, reading as grey cloud. The
# mark's glow is attached to the mark; that residue is not. Keep only what lies near
# confidently solid pixels.
# The swing is not uniform across the frame (JPEG compresses the tone contrast unevenly),
# so demodulated alpha alone still floats above zero over parts of the bare backdrop.
# Gate it with the raw deviation from the known checker tones, which does separate
# cleanly on this image: the backdrop reaches 40 at the 99th percentile, the mark 120+.
background = np.where(parity, LIGHT, DARK)[:, :, None]
deviation = np.abs(img - background).max(axis=2)
gate = np.clip(box_blur((deviation > 62).astype(np.float64), 3) * 2.0, 0.0, 1.0)
alpha *= gate

# Drop isolated speckles the gate let through, so the crop below finds the mark and not
# a stray pixel in the far corner.
dense = box_blur((alpha > 0.5).astype(np.float64), 4) > 0.30
alpha *= box_blur(dense.astype(np.float64), 10) > 1e-3
print(f"gate keeps {100 * (alpha > 0).mean():.1f}% of the frame")

# Remove the carrier, then unpremultiply against the flat background it leaves behind.
carrier = (sign * amplitude)[:, :, None]
flat = img - carrier
safe = np.maximum(alpha, 0.06)[:, :, None]
colour = np.clip((flat - (1.0 - safe) * MID) / safe, 0, 255)

mask = np.argwhere(alpha > 0.10)
top, left = mask.min(axis=0)
bottom, right = mask.max(axis=0)
print(f"square={square:.2f} bbox=({left},{top})-({right},{bottom})")

rgba = np.dstack([colour, alpha * 255.0]).astype(np.uint8)
out = Image.fromarray(rgba, "RGBA").crop((left - 8, top - 8, right + 8, bottom + 8))

side = max(out.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2), out)
master = canvas.resize((512, 512), Image.LANCZOS)
master.save("public/arc-logo.png")

check = Image.new("RGB", (512, 512), (26, 24, 21))
check.paste(master, (0, 0), master)
check.save("public/arc-logo-check.png")
print("wrote public/arc-logo.png")
