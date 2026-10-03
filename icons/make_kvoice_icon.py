# -*- coding: utf-8 -*-
"""v8.3(O-0161) 앱 서랍 「케이 음성」 아이콘 만들기 — 케이 얼굴(버건디 정장 기본 옷) + 오른쪽 아래 작은 마이크 배지.
   출력: res/mipmap-*/ic_kvoice_bg.png · ic_kvoice_fg.png (적응형 아이콘 두 겹) + ic_kvoice.png(옛 기기용 둥근 그림)
         res/mipmap-anydpi-v26/ic_kvoice.xml
   다시 만들 때: python icons/make_kvoice_icon.py  (저장소 루트에서)"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "www", "assets", "k", "burgundy_suit", "expr_smile.jpg")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
LAYER = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
BG = (233, 233, 238, 255)
BLUE = (37, 99, 235, 255)         # 앱 기본 아이콘 배경색(#2563EB)과 같은 파랑


def face_canvas():
    """보이는 영역(가운데 2/3)에 얼굴 정사각형(원본 100,30~620,550)이 오도록 780px 캔버스에 앉힌다."""
    im = Image.open(SRC).convert("RGBA")
    cv = Image.new("RGBA", (780, 780), BG)
    cv.paste(im, (30, 100))
    return cv


def mic_badge(size, cx, cy, r):
    """투명 바탕 위 파란 원 + 흰 마이크."""
    S = size * 4                                       # 4배로 그려서 줄이면 테두리가 매끈
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    X, Y, R = cx * 4, cy * 4, r * 4
    d.ellipse([X - R - R * 0.12, Y - R - R * 0.12, X + R + R * 0.12, Y + R + R * 0.12], fill=(255, 255, 255, 255))
    d.ellipse([X - R, Y - R, X + R, Y + R], fill=BLUE)
    w = R * 0.42; h = R * 0.78
    d.rounded_rectangle([X - w / 2, Y - h * 0.62, X + w / 2, Y + h * 0.22], radius=w / 2, fill=(255, 255, 255, 255))
    lw = max(2, int(R * 0.11))
    aw = R * 0.66
    d.arc([X - aw / 2, Y - h * 0.40, X + aw / 2, Y + h * 0.42], start=0, end=180, fill=(255, 255, 255, 255), width=lw)
    d.line([X, Y + h * 0.42, X, Y + h * 0.62], fill=(255, 255, 255, 255), width=lw)
    d.line([X - R * 0.2, Y + h * 0.62, X + R * 0.2, Y + h * 0.62], fill=(255, 255, 255, 255), width=lw)
    return im.resize((size, size), Image.LANCZOS)


def main():
    cv = face_canvas()
    for dn, s in LAYER.items():
        d = os.path.join(RES, "mipmap-" + dn)
        os.makedirs(d, exist_ok=True)
        cv.resize((s, s), Image.LANCZOS).save(os.path.join(d, "ic_kvoice_bg.png"))
        mic_badge(s, s * 0.67, s * 0.67, s * 0.07).save(os.path.join(d, "ic_kvoice_fg.png"))
    # 옛 기기(안드로이드 7 이하)용: 보이는 영역만 잘라 둥글게 + 배지
    vis = cv.crop((130, 130, 650, 650))
    for dn, s in LEGACY.items():
        S = s * 4
        face = vis.resize((S, S), Image.LANCZOS)
        mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0)); out.paste(face, (0, 0), mask)
        out = out.resize((s, s), Image.LANCZOS)
        out.alpha_composite(mic_badge(s, s * 0.78, s * 0.78, s * 0.17))
        out.save(os.path.join(RES, "mipmap-" + dn, "ic_kvoice.png"))
    os.makedirs(os.path.join(RES, "mipmap-anydpi-v26"), exist_ok=True)
    with open(os.path.join(RES, "mipmap-anydpi-v26", "ic_kvoice.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<!-- v8.3(O-0161) 「케이 음성」 적응형 아이콘: 케이 얼굴(배경) + 마이크 배지(앞). icons/make_kvoice_icon.py 로 생성 -->\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@mipmap/ic_kvoice_bg"/>\n'
                '    <foreground android:drawable="@mipmap/ic_kvoice_fg"/>\n'
                '</adaptive-icon>\n')
    print("ok")


if __name__ == "__main__":
    main()
