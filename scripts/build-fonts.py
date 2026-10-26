# Builds the site's Chinese typefaces: static weights of Noto Sans TC (gothic, body) and Noto Serif TC Black (mincho, titles),
# subset to the characters the site actually shows, so the PWA can cache them and pages stay light.
#   python scripts/build-fonts.py <NotoSansTC[wght].ttf | -> <NotoSerifTC[wght].ttf>   ("-" keeps the existing sans files)
# Sources: github.com/google/fonts ofl/notosanstc, ofl/notoseriftc (Adobe Source Han, SIL OFL 1.1). Needs fonttools + brotli.
# Characters outside the subset (a brand-new player name, say) still display: the browser uses the system font for them.
import pathlib
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'vendor' / 'fonts'
SOURCES = ['index.html', *sorted(p.name for p in ROOT.glob('*.js')), 'manifest.webmanifest']
DATA = [*sorted((ROOT / 'data').glob('*.json')), *sorted((ROOT / 'tests' / 'fixtures' / 'data').glob('*.json'))]
# Punctuation and symbols used in Chinese typesetting, plus the common characters a scorer is likely to type.
EXTRA = '，。、：；！？「」『』（）《》〈〉【】〔〕～—…·・％＋－＝＞＜／０１２３４５６７８９' \
        '一二三四五六七八九十百千萬億零壹貳參肆伍陸柒捌玖拾上下左右前後中內外東西南北年月日時分秒週星期今昨明' \
        '球隊員打擊投捕壘安全出局分比賽場記錄數據率棒次守備位置換人先發代跑代打保送三振高飛滾地平飛界外觸身好壞' \
        '王李張劉陳楊黃趙吳周徐孫馬朱胡郭何高林羅鄭梁謝宋唐許韓馮鄧曹彭曾肖田董袁潘于蔣蔡余杜葉程蘇魏呂丁任沈姚盧' \
        '姜崔鍾譚陸汪范金石廖賈夏韋付方白鄒孟熊秦邱江尹薛閻段雷侯龍史陶黎賀顧毛郝龔邵萬錢嚴覃武戴莫孔向湯洪柯翁' \
        '承均宣嘉泓銘侑宸偉豪志明俊傑家宏建華文彥廷宇翔哲軒睿凱博信恩誠瑋柏翰庭維勳霖晨昊佑丞恆祐鈞璋'


def site_characters():
    text = []
    for name in SOURCES:
        path = ROOT / name
        if path.exists():
            text.append(path.read_text(encoding='utf-8', errors='ignore'))
    for path in DATA:
        raw = path.read_text(encoding='utf-8', errors='ignore')
        # Avatars are base64 images; only names, tags and notes matter.
        text.append(re.sub(r'data:image/[^"]+', '', raw))
    text.append(EXTRA)
    chars = {c for c in ''.join(text) if ord(c) >= 0x2000}
    return ''.join(sorted(chars))


def build(source, weight, target, chars):
    font = TTFont(source)
    static = instancer.instantiateVariableFont(font, {'wght': weight})
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['palt', 'vpal', 'kern', 'liga', 'locl', 'ccmp', 'halt', 'vert']
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.desubroutinize = True
    sub = subset.Subsetter(options)
    sub.populate(text=chars)
    sub.subset(static)
    static.flavor = 'woff2'
    static.save(OUT / target)
    return (OUT / target).stat().st_size


def main():
    sans, serif = sys.argv[1], sys.argv[2]
    chars = site_characters()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'tk-charset.txt').write_text(chars, encoding='utf-8')
    sizes = {}
    if sans != '-':
        for weight in (400, 500, 700):
            sizes[f'tk-sans-{weight}.woff2'] = build(sans, weight, f'tk-sans-{weight}.woff2', chars)
    sizes['tk-serif-900.woff2'] = build(serif, 900, 'tk-serif-900.woff2', chars)
    print(f'{len(chars)} characters')
    for name, size in sizes.items():
        print(f'{name}: {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
