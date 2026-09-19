# -*- coding: utf-8 -*-
"""스마트비서 아이콘 생성 — 파랑 배경 + 흰 말풍선 + AI 스파크(세련·심플).
웹(PWA) 아이콘 + 안드로이드 런처/adaptive 아이콘 세트를 함께 만든다."""
import os, math
from PIL import Image, ImageDraw

BLUE1 = (59, 130, 246, 255)   # #3b82f6
BLUE2 = (37, 99, 235, 255)    # #2563eb
WHITE = (255, 255, 255, 255)
SS = 4

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW_ICONS = os.path.join(APP, "www", "icons")
RES = os.path.join(APP, "android", "app", "src", "main", "res")


def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def star4(cx, cy, r, inner=0.34):
    pts = []
    for i in range(8):
        ang = math.radians(90 - 45 * i)   # 위에서 시작, 시계방향
        rr = r if i % 2 == 0 else r * inner
        pts.append((cx + rr * math.cos(ang), cy - rr * math.sin(ang)))
    return pts


def draw_symbol(d, W, scale, cy_shift=0.0):
    """흰 말풍선 + 스파크. 심볼이 W*scale 안에 들어오게 중앙 배치."""
    cx = W / 2.0
    cy = W / 2.0 + W * cy_shift
    S = W * scale
    # 말풍선(둥근 사각) + 꼬리
    bw, bh = S * 0.90, S * 0.66
    bx0, by0 = cx - bw / 2, cy - bh / 2 - S * 0.02
    bx1, by1 = bx0 + bw, by0 + bh
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=bh * 0.36, fill=WHITE)
    tw = S * 0.17
    txf = bx0 + bw * 0.26
    d.polygon([(txf, by1 - S * 0.02), (txf + tw, by1 - S * 0.02),
               (txf + tw * 0.15, by1 + S * 0.17)], fill=WHITE)
    # 말풍선 안: 파랑 스파크(스마트/AI)
    d.polygon(star4(cx, (by0 + by1) / 2, S * 0.20), fill=BLUE2)
    # 오른쪽 위 작은 흰 스파크(반짝임)
    d.polygon(star4(bx1 - S * 0.02, by0 + S * 0.02, S * 0.12), fill=WHITE)


def bg_gradient(W):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    for y in range(W):
        dd.line([(0, y), (W, y)], fill=lerp(BLUE1, BLUE2, y / W))
    return img


def make(size, mode="rounded"):
    """mode: rounded(웹) / maskable(full bleed, 작은심볼) / adaptivefg(투명+심볼만) / full(꽉찬 배경)"""
    W = size * SS
    if mode == "adaptivefg":
        img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        draw_symbol(d, W, 0.42)          # 안전영역(중앙 66%) 안에 들어오게 작게
        return img.resize((size, size), Image.LANCZOS)
    grad = bg_gradient(W)
    if mode == "rounded":
        bg = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        ImageDraw.Draw(bg).rounded_rectangle([0, 0, W - 1, W - 1], radius=0.225 * W, fill=(255, 255, 255, 255))
        grad = Image.composite(grad, Image.new("RGBA", (W, W), (0, 0, 0, 0)), bg.split()[3])
        scale = 0.62
    elif mode == "maskable":
        scale = 0.52
    else:  # full (런처 정사각/원형은 밖에서 마스크)
        scale = 0.62
    d = ImageDraw.Draw(grad)
    draw_symbol(d, W, scale)
    return grad.resize((size, size), Image.LANCZOS)


def make_round(size):
    im = make(size, "full")
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


os.makedirs(WWW_ICONS, exist_ok=True)
# --- 웹/PWA ---
make(512, "rounded").save(os.path.join(WWW_ICONS, "icon-512.png"))
make(192, "rounded").save(os.path.join(WWW_ICONS, "icon-192.png"))
make(512, "maskable").save(os.path.join(WWW_ICONS, "icon-maskable-512.png"))
make(180, "rounded").save(os.path.join(WWW_ICONS, "apple-touch-icon.png"))
# 미리보기
prev = Image.new("RGBA", (96 * 3 + 40, 96), (240, 240, 245, 255))
prev.alpha_composite(make(96, "rounded"), (10, 0))
prev.alpha_composite(make(96, "maskable"), (116, 0))
prev.alpha_composite(make(48, "rounded").resize((96, 96), Image.NEAREST), (222, 0))
prev.save(os.path.join(WWW_ICONS, "_preview.png"))

# --- 안드로이드 런처(mipmap) + adaptive foreground ---
LA = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for dpi, sz in LA.items():
    dpath = os.path.join(RES, "mipmap-" + dpi)
    os.makedirs(dpath, exist_ok=True)
    make(sz, "full").save(os.path.join(dpath, "ic_launcher.png"))
    make_round(sz).save(os.path.join(dpath, "ic_launcher_round.png"))
    make(FG[dpi], "adaptivefg").save(os.path.join(dpath, "ic_launcher_foreground.png"))
print("done. web+android 아이콘 생성.")
