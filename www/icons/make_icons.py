# -*- coding: utf-8 -*-
"""
음성 메모 정리 앱 아이콘 생성기 (Pillow)
- 파랑 배경(#2563eb) + 중앙 흰색 마이크 + 정리(체크) 심볼
- 슈퍼샘플링(4x) 후 LANCZOS 축소로 가장자리 선명
- 산출: 192, 512, maskable 512(여백), apple-touch 180
"""
from PIL import Image, ImageDraw

BLUE = (37, 99, 235, 255)      # #2563eb
BLUE_DARK = (29, 78, 216, 255) # #1d4ed8 (미세 그라데이션용)
WHITE = (255, 255, 255, 255)
GREEN = (34, 197, 94, 255)     # 체크 배지 색 (#22c55e)
SS = 4                          # supersample

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(4))

def draw_symbol(d, box, with_check=True):
    """box=(ox,oy,side) 안에 100x100 좌표계로 마이크(+체크)를 흰색으로 그림"""
    ox, oy, side = box
    def X(v): return ox + v/100.0*side
    def Y(v): return oy + v/100.0*side
    def L(v): return v/100.0*side  # 길이 스케일

    # --- 마이크 몸통(세로 알약) ---
    cap_l, cap_r = 38, 62
    cap_t, cap_b = 12, 58
    d.rounded_rectangle([X(cap_l), Y(cap_t), X(cap_r), Y(cap_b)],
                        radius=L((cap_r-cap_l)/2), fill=WHITE)

    # --- 크래들(U자 아치) ---
    arc_box = [X(30), Y(30), X(70), Y(70)]
    d.arc(arc_box, start=15, end=165, fill=WHITE, width=int(L(6)))

    # --- 스탠드(세로) ---
    d.line([X(50), Y(66), X(50), Y(80)], fill=WHITE, width=int(L(6)))
    # --- 받침(가로, 둥근 끝) ---
    d.rounded_rectangle([X(39), Y(78), X(61), Y(83)], radius=L(2.5), fill=WHITE)

    # --- 정리/완료 체크 배지 (우하단) ---
    if with_check:
        cx, cy, r = X(70), Y(72), L(20)
        # 배경 원(살짝 파랑 테두리 효과: 흰 원 + 초록 체크)
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=WHITE)
        # 초록 체크
        d.line([cx-L(9), cy+L(1), cx-L(2), cy+L(8)], fill=GREEN, width=int(L(5)))
        d.line([cx-L(2), cy+L(8), cx+L(11), cy-L(9)], fill=GREEN, width=int(L(5)))

def make(size, maskable=False, rounded=True, with_check=True):
    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 배경(세로 미세 그라데이션)
    if maskable:
        # maskable: 배경을 정사각형 꽉 채움, 심볼은 안전영역(중앙 ~66%)
        for y in range(W):
            d.line([(0, y), (W, y)], fill=lerp(BLUE, BLUE_DARK, y/W))
        sym = 0.60 * W
    else:
        radius = 0.225 * W if rounded else 0
        # 라운드 배경
        bg = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        bd = ImageDraw.Draw(bg)
        bd.rounded_rectangle([0, 0, W-1, W-1], radius=radius, fill=BLUE)
        # 그라데이션 오버레이
        grad = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        gd = ImageDraw.Draw(grad)
        for y in range(W):
            gd.line([(0, y), (W, y)], fill=lerp((255,255,255,0), (0,0,0,28), y/W))
        bg = Image.alpha_composite(bg, grad)
        img = Image.alpha_composite(img, bg)
        d = ImageDraw.Draw(img)
        sym = 0.72 * W

    ox = (W - sym) / 2
    oy = (W - sym) / 2
    draw_symbol(d, (ox, oy, sym), with_check=with_check)

    img = img.resize((size, size), Image.LANCZOS)
    return img

import os
OUT = os.path.dirname(os.path.abspath(__file__))

make(512).save(os.path.join(OUT, "icon-512.png"))
make(192).save(os.path.join(OUT, "icon-192.png"))
make(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
make(180).save(os.path.join(OUT, "apple-touch-icon.png"))
# 미리보기(작은 크기 선명도 점검용)
prev = Image.new("RGBA", (96*3+40, 96), (240,240,245,255))
prev.alpha_composite(make(96), (10, 0))
prev.alpha_composite(make(96, maskable=True), (10+96+10, 0))
prev.alpha_composite(make(48).resize((96,96), Image.NEAREST), (10+192+20, 0))
prev.save(os.path.join(OUT, "_preview.png"))
print("done:", os.listdir(OUT))
