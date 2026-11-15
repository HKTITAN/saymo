import sys, json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
f = TTFont(sys.argv[1])
f = instantiateVariableFont(f, {"wght": 600, "opsz": 96, "wdth": 100} if "wdth" in [a.axisTag for a in f["fvar"].axes] else {"wght": 600, "opsz": 96})
cmap = f.getBestCmap(); gs = f.getGlyphSet(); hmtx = f["hmtx"]
text = "saymo"
upm = f["head"].unitsPerEm
# kerning ignored (GPOS); fine for a wordmark
x = 0; glyphs = []
for ch in text:
    g = cmap[ord(ch)]; glyphs.append((ch, g, x)); x += hmtx[g][0]
# bounds
bp = BoundsPen(gs)
for ch,g,ox in glyphs:
    tp = TransformPen(bp, (1,0,0,1,ox,0)); gs[g].draw(tp)
xmin,ymin,xmax,ymax = bp.bounds
H = 29.0; s = H / (ymax - ymin)
def path(g, ox):
    sp = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    tp = TransformPen(sp, (s,0,0,-s,(ox-xmin)*s, ymax*s)); gs[g].draw(tp)
    return sp.getCommands()
out = {"width": round((xmax-xmin)*s,2), "height": H, "letters": [], "mark": [], "markX": None}
for ch,g,ox in glyphs:
    d = path(g, ox)
    if ch == "o":
        out["mark"].append(d)
        b = BoundsPen(gs); gs[g].draw(TransformPen(b,(1,0,0,1,ox,0)))
        out["markX"] = [round((b.bounds[0]-xmin)*s,2), round((b.bounds[2]-xmin)*s,2)]
    else: out["letters"].append(d)
print(json.dumps(out))
