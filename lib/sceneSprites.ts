// Scenery for Duck Valley, drawn as text. Every sprite has a day and a night palette,
// so night is a real repaint of the same world and not a dark filter.
import { pixelArt, type PixelImage } from "./pixel";

type Colors = Record<string, string>;
type Sprite = { rows: string[]; day: Colors; night: Colors };

const K = "#21191B";
const KN = "#0F0C14";

const SPRITES = {
  cloud: {
    rows: [
      "........WWWWWW..........",
      "......WWWWWWWWWW........",
      "..WWWWWWWWWWWWWWWW......",
      ".WWWWWWWWWWWWWWWWWWWW...",
      "WWWWWWWWWWWWWWWWWWWWWWW.",
      "WWWWWWWWWWWWWWWWWWWWWWWW",
      "wwWWWWWWWWWWWWWWWWWWWWww",
      ".wwwwwwWWWWWWWWWwwwwwww.",
      "...wwwwwwwwwwwwwwww.....",
    ],
    day: { W: "#FFF1DB", w: "#EBD5BC" },
    night: { W: "#4D477B", w: "#3B3666" },
  },
  pine: {
    rows: [
      ".....KK.........",
      "....KggK........",
      "....KgGK........",
      "...KgggGK.......",
      "...KggGGK.......",
      "..KgggGGGK......",
      "..KKgGGGKK......",
      "..KggggGGK......",
      ".KgggggGGGK.....",
      ".KKggGGGGKK.....",
      ".KgggggGGGK.....",
      "KggggggGGGGK....",
      "KKKgGGGGGKKK....",
      "...KKTTKK.......",
      "....KTTK........",
      "....KTTK........",
    ],
    day: { K, g: "#5E9A4A", G: "#3E7240", T: "#68402E" },
    night: { K: KN, g: "#2F5A50", G: "#1F3F3C", T: "#2E2230" },
  },
  pineFar: {
    rows: [
      "....gg......",
      "...gggg.....",
      "...gggg.....",
      "..gggggg....",
      "..gggggg....",
      ".gggggggg...",
      ".gggggggg...",
      "gggggggggg..",
      "gggggggggg..",
      "gggggggggg..",
    ],
    day: { g: "#4F8A63" },
    night: { g: "#22324F" },
  },
  cottage: {
    rows: [
      "..............KKK.....",
      "..............KSK.....",
      "......KKKKKKKKKSK.....",
      ".....KRRRRRRRRRSKK....",
      "....KRrRRRRRRRRRRRK...",
      "...KRRRRRRrRRRRRRRRK..",
      "..KRRRrRRRRRRRRrRRRRK.",
      ".KKKKKKKKKKKKKKKKKKKKK",
      "..KCCCCCCCCCCCCCCCCK..",
      "..KCKKKKCCCCCCKKKKCK..",
      "..KCKYYKCCCCCCKDDKCK..",
      "..KCKYYKCCCCCCKDdKCK..",
      "..KCKKKKCCCCCCKDDKCK..",
      "..KCCCCCCCCCCCKDDKCK..",
      "..KKKKKKKKKKKKKKKKKK..",
    ],
    day: { K, R: "#EF6D64", r: "#C94D4A", S: "#9A8F8A", C: "#FFF0D5", Y: "#9FD8F5", D: "#C98148", d: "#FFD84A" },
    night: { K: KN, R: "#7A3F58", r: "#5E2F47", S: "#3A3550", C: "#4D477B", Y: "#FFBE67", D: "#5A3A2C", d: "#FFBE67" },
  },
  bush: {
    rows: [
      "....KKKK....",
      "..KKggggKK..",
      ".KggggGggGK.",
      "KggpggGGGGGK",
      "KgggGGGGGpGK",
      "KKKKKKKKKKKK",
    ],
    day: { K, g: "#7FB357", G: "#5E9A4A", p: "#EF6D64" },
    night: { K: KN, g: "#3D6B58", G: "#2F5A50", p: "#7A3F58" },
  },
  rock: {
    rows: [
      "..KKKK..",
      ".KssSSK.",
      "KsssSSSK",
      "KsSSSSSK",
      "KKKKKKKK",
    ],
    day: { K, s: "#C9C2BC", S: "#9A8F8A" },
    night: { K: KN, s: "#5A5878", S: "#3A3550" },
  },
  flowerA: {
    rows: [".p.p.", "ppypp", ".ppp.", "..g..", ".gg..", "..g.."],
    day: { p: "#EF6D64", y: "#FFD84A", g: "#3E7240" },
    night: { p: "#8C4A6A", y: "#FFBE67", g: "#1F3F3C" },
  },
  flowerB: {
    rows: [".w.w.", "wwyww", ".www.", "..g..", "..gg.", "..g.."],
    day: { w: "#FFF1DB", y: "#FFA552", g: "#3E7240" },
    night: { w: "#8A84B8", y: "#FFBE67", g: "#1F3F3C" },
  },
  mushroom: {
    rows: [
      "..KKK..",
      ".KRwRK.",
      "KRRRRwK",
      "KKKKKKK",
      "..KCK..",
      "..KKK..",
    ],
    day: { K, R: "#EF6D64", w: "#FFF1DB", C: "#FFF0D5" },
    night: { K: KN, R: "#7A3F58", w: "#F6E7CF", C: "#8A84B8" },
  },
  stump: {
    rows: [
      ".KKKKKK.",
      "KttTtttK",
      "KTTTTTTK",
      "KTtTTtTK",
      "KKTTTTKK",
      ".KKKKKK.",
    ],
    day: { K, t: "#E0A56E", T: "#C98148" },
    night: { K: KN, t: "#6B4A3A", T: "#4B3328" },
  },
  fence: {
    rows: [
      ".KK......KK.....",
      "KwwK....KwwK....",
      "KwWKKKKKKwWKKKKK",
      "KwWwwwwwwwWwwwww",
      "KwWKKKKKKwWKKKKK",
      "KwWK....KwWK....",
      "KwWKKKKKKwWKKKKK",
      "KwWwwwwwwwWwwwww",
      "KwWKKKKKKwWKKKKK",
      "KwWK....KwWK....",
      "KKKK....KKKK....",
    ],
    day: { K, w: "#E0A56E", W: "#C98148" },
    night: { K: KN, w: "#6B4A3A", W: "#4B3328" },
  },
  lantern: {
    rows: [
      "..KKK..",
      ".KKKKK.",
      ".KYyYK.",
      ".KyYyK.",
      ".KYyYK.",
      ".KKKKK.",
      "..KWK..",
      "..KWK..",
      "..KWK..",
      "..KWK..",
      "..KWK..",
      ".KKKKK.",
    ],
    day: { K, Y: "#FFF1DB", y: "#FFE9A8", W: "#68402E" },
    night: { K: KN, Y: "#FFBE67", y: "#FFE9A8", W: "#2E2230" },
  },
  bridge: {
    rows: [
      "KK....................KK",
      "KwK..................KwK",
      "KwKKKKKKKKKKKKKKKKKKKKwK",
      "KwWwwwwwwwwwwwwwwwwwwWwK",
      "KwKKKKKKKKKKKKKKKKKKKKwK",
      "KKpPpPpPpPpPpPpPpPpPpPKK",
      "KpPpPpPpPpPpPpPpPpPpPpPK",
      "KKKKKKKKKKKKKKKKKKKKKKKK",
      ".KW..................WK.",
      ".KK..................KK.",
    ],
    day: { K, w: "#E0A56E", W: "#C98148", p: "#D99458", P: "#B56F3C" },
    night: { K: KN, w: "#6B4A3A", W: "#4B3328", p: "#5E4034", P: "#463028" },
  },
  radio: {
    rows: [
      "....K......K....",
      ".....K....K.....",
      ".KKKKKKKKKKKKKK.",
      "KWWWWWWWWWWWWWWK",
      "KWKKKKWWLLLLLWWK",
      "KWKssKWWLlLlLWWK",
      "KWKssKWWLLLLLWWK",
      "KWKKKKWWWWWWWWWK",
      "KWWWWWWWoWWoWWWK",
      "KwwwwwwwwwwwwwwK",
      "KKKKKKKKKKKKKKKK",
      ".KK..........KK.",
    ],
    day: { K, W: "#C98148", w: "#A8693C", s: "#3A3040", L: "#FFF0D5", l: "#EF6D64", o: "#FFD84A" },
    night: { K: KN, W: "#6B4A3A", w: "#4B3328", s: "#1A1622", L: "#FFBE67", l: "#EF6D64", o: "#FFBE67" },
  },
  sun: {
    rows: [
      ".....y....y.....",
      "................",
      "....KKKKKKKK....",
      "...KYYYYYYYYK...",
      "..KYYYYHHYYYYK..",
      "y.KYYYHHYYYYYK.y",
      "..KYYYYYYYYYYK..",
      "..KYYYYYYYYYYK..",
      "y.KYYYYYYYYYYK.y",
      "..KYYYYYYYYYYK..",
      "...KYYYYYYYYK...",
      "....KKKKKKKK....",
      "................",
      ".....y....y.....",
    ],
    day: { K: "#E9A92C", Y: "#FFD84A", H: "#FFF3A6", y: "#FFE98A" },
    night: { K: "#D9C592", Y: "#FFF0BE", H: "#E6D49C", y: "transparent" },
  },
  crown: {
    rows: ["K.K.K.K", "KYKYKYK", "KYYYYYK", "KyyyyyK", "KKKKKKK"],
    day: { K, Y: "#FFD84A", y: "#E9A92C" },
    night: { K: KN, Y: "#FFD84A", y: "#E9A92C" },
  },
  grass: {
    rows: [
      "................",
      "..l.............",
      ".lll......d.....",
      "..........dd....",
      "................",
      "................",
      "......d.........",
      ".....dd.....l...",
      "...........lll..",
      "................",
      "................",
      "..l.............",
      "..ll....d.......",
      "................",
      "................",
      "................",
    ],
    day: { l: "#9DBD63", d: "#5F8A3A" },
    night: { l: "#44695A", d: "#27433A" },
  },
  // --- Boat Festival ---
  bunting: {
    rows: [
      "ssssssssssssssssssssssssssssssss",
      ".aaaaa...bbbbb...ccccc...ddddd..",
      ".aaaaa...bbbbb...ccccc...ddddd..",
      "..aaa.....bbb.....ccc.....ddd...",
      "..aaa.....bbb.....ccc.....ddd...",
      "...a.......b.......c.......d....",
    ],
    day: { s: "#68402E", a: "#EF6D64", b: "#FFD84A", c: "#6FB4F2", d: "#FFF1DB" },
    night: { s: "#2E2230", a: "#C4524E", b: "#FFBE67", c: "#5A7FC0", d: "#D9C9B0" },
  },
  paperLantern: {
    rows: [
      "KKKKKKK..",
      "KW...K...",
      "KW..KKK..",
      "KW.KrRrK.",
      "KW.KRRRK.",
      "KW.KrRrK.",
      "KW..KKK..",
      "KW...y...",
      "KW...y...",
      "KW.......",
      "KW.......",
      "KW.......",
      "KW.......",
      "KKK......",
    ],
    day: { K, W: "#C98148", r: "#EF6D64", R: "#FF9A8F", y: "#FFD84A" },
    night: { K: KN, W: "#4B3328", r: "#FF8A3C", R: "#FFE9A8", y: "#FFBE67" },
  },
  stall: {
    rows: [
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
      ".KrrwwrrwwrrwwrrwwrrwwrrwwK.",
      "KrrwwrrwwrrwwrrwwrrwwrrwwrrK",
      "KRRWWRRWWRRWWRRWWRRWWRRWWRRK",
      "KKKKKKKKKKKKKKKKKKKKKKKKKKKK",
      "..KP........L.L.........PK..",
      "..KP....................PK..",
      "..KP..ff..gg..bb..ff..gg.PK.",
      "..KP..ff..gg..bb..ff..gg.PK.",
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
      "..KTtTTTTtTTTTTtTTTTtTTTTK..",
      "..KTTTTTTTTTTTTTTTTTTTTTTK..",
      "..KTTtTTTTTtTTTTTtTTTTTtTK..",
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
    ],
    day: { K, r: "#EF6D64", R: "#C94D4A", w: "#FFF1DB", W: "#EBD5BC", P: "#C98148", T: "#C98148", t: "#E0A56E", L: "#FFD84A", f: "#FFA552", g: "#7FB357", b: "#FF9EC4" },
    night: { K: KN, r: "#B8504E", R: "#8C3A3C", w: "#D9C9B0", W: "#B0A08C", P: "#6B4A3A", T: "#5E4034", t: "#7A5646", L: "#FFE9A8", f: "#FFBE67", g: "#5C8F52", b: "#D97FA6" },
  },
  drum: {
    rows: [
      "..KKKKKK..",
      ".KccccccK.",
      "KKKKKKKKKK",
      "KRgRgRgRgK",
      "KRRRRRRRRK",
      "KRgRgRgRgK",
      "KKKKKKKKKK",
      ".KK....KK.",
    ],
    day: { K, c: "#FFF1DB", R: "#EF6D64", g: "#FFD84A" },
    night: { K: KN, c: "#D9C9B0", R: "#B8504E", g: "#FFBE67" },
  },
  // --- Seasonal events ---
  snowGround: {
    rows: [
      "................",
      "..l.............",
      ".lll......d.....",
      "..........dd....",
      "................",
      "................",
      "......d.........",
      ".....dd.....l...",
      "...........lll..",
      "................",
      "................",
      "..l.............",
      "..ll....d.......",
      "................",
      "................",
      "................",
    ],
    day: { l: "#FFFFFF", d: "#D3E2F0" },
    night: { l: "#C9D8EA", d: "#7F96B3" },
  },
  rainCloud: {
    rows: [
      "........WWWWWW..........",
      "......WWWWWWWWWW........",
      "..WWWWWWWWWWWWWWWW......",
      ".WWWWWWWWWWWWWWWWWWWW...",
      "WWWWWWWWWWWWWWWWWWWWWWW.",
      "WWWWWWWWWWWWWWWWWWWWWWWW",
      "wwWWWWWWWWWWWWWWWWWWWWww",
      ".wwwwwwWWWWWWWWWwwwwwww.",
      "...wwwwwwwwwwwwwwww.....",
    ],
    day: { W: "#8C9BAA", w: "#6F7E8E" },
    night: { W: "#3A3F5C", w: "#2B2F47" },
  },
  pumpkin: {
    rows: ["....KgK...", "..KKKKKK..", ".KOoOOoOK.", "KOoOOOOoOK", "KOKKOOKKOK", "KOoOKKOoOK", ".KKKKKKKK."],
    day: { K, O: "#F58A1F", o: "#FFB04A", g: "#4FA545" },
    night: { K: KN, O: "#D9701A", o: "#FFD27A", g: "#2F5A50" },
  },
  tombstone: {
    rows: ["..KKKK..", ".KssssK.", "KssssssK", "KsKKKKsK", "KssssssK", "KsKKKssK", "KssssssK", "KKKKKKKK"],
    day: { K, s: "#B8B2C4" },
    night: { K: KN, s: "#5A5878" },
  },
  deadTree: {
    rows: [
      ".....t......",
      "t....t...t..",
      ".t...t..t...",
      "..t..tt.t...",
      "...t.ttt....",
      "....ttt.....",
      ".t..tt......",
      "..t.tt..t...",
      "...ttt.t....",
      "....ttt.....",
      "....tt......",
      "....tt......",
      "....tt......",
      "...tttt.....",
    ],
    day: { t: "#4B3328" },
    night: { t: "#1A1220" },
  },
  candle: {
    rows: [".y.", ".f.", "www", "wWw", "www"],
    day: { y: "#FFD84A", f: "#F58A1F", w: "#FFF1DB", W: "#E4D3C0" },
    night: { y: "#FFF3A6", f: "#FFBE67", w: "#D9C9B0", W: "#B0A08C" },
  },
  xmasTree: {
    rows: [
      "......yy......",
      "......yy......",
      ".....KGGK.....",
      "....KGgGGK....",
      "...KGGrGGGK...",
      "...KKGGGGKK...",
      "...KGgGGbGK...",
      "..KGGGGGGGGK..",
      ".KGrGGgGGGyGK.",
      ".KKKGGGGGGKKK.",
      "..KGGbGGgGGK..",
      ".KGGGGGGGGGGK.",
      "KGgGGrGGGGyGGK",
      "KKKKKKKKKKKKKK",
      ".....KTTK.....",
      ".....KTTK.....",
    ],
    day: { K, G: "#3E7240", g: "#5E9A4A", r: "#EF6D64", b: "#6FB4F2", y: "#FFD84A", T: "#68402E" },
    night: { K: KN, G: "#1F3F3C", g: "#2F5A50", r: "#FF8A7A", b: "#9CC8FF", y: "#FFE98A", T: "#2E2230" },
  },
  bulbs: {
    rows: ["ssssssssssssssssssssssss", ".rr...yy...bb...gg...pp.", ".rr...yy...bb...gg...pp."],
    day: { s: "#3A3040", r: "#EF6D64", y: "#FFD84A", b: "#6FB4F2", g: "#7FD66B", p: "#FF8FBA" },
    night: { s: "#1A1622", r: "#FF8A7A", y: "#FFE98A", b: "#9CC8FF", g: "#A6F08F", p: "#FFB3D1" },
  },
  fairyBulbs: {
    rows: ["ssssssssssssssssssssssss", ".ww...ww...ww...ww...ww.", ".ww...ww...ww...ww...ww."],
    day: { s: "#68402E", w: "#FFE9A8" },
    night: { s: "#2E2230", w: "#FFF3C4" },
  },
  gift: {
    rows: [".yy..yy.", "KKKyyKKK", "KRRyyRRK", "KKKyyKKK", "KRRyyRRK", "KRRyyRRK", "KKKKKKKK"],
    day: { K, R: "#EF6D64", y: "#FFD84A" },
    night: { K: KN, R: "#B8504E", y: "#FFBE67" },
  },
  giftBlue: {
    rows: [".yy..yy.", "KKKyyKKK", "KRRyyRRK", "KKKyyKKK", "KRRyyRRK", "KRRyyRRK", "KKKKKKKK"],
    day: { K, R: "#4F8FE0", y: "#FFF1DB" },
    night: { K: KN, R: "#3A62A8", y: "#D9C9B0" },
  },
  snowman: {
    rows: [
      "...KKKK...",
      "...KkkK...",
      "..KKKKKK..",
      "..KWkWkK..",
      "..KWWoWK..",
      "..KWWWWK..",
      ".KKrrrrKK.",
      "KWWWWWWWWK",
      "KWWWkWWWWK",
      "KWWWWWWWWK",
      "KWWWkWWWWK",
      ".KWWWWWWK.",
      "..KKKKKK..",
    ],
    day: { K, W: "#FFFFFF", k: "#3A3040", o: "#F58A1F", r: "#EF6D64" },
    night: { K: KN, W: "#C9D8EA", k: "#1A1622", o: "#D9701A", r: "#B8504E" },
  },
  puddle: {
    rows: ["...eeeeeeee...", ".eeWWWhWWWWee.", ".eeWWWWWWhWee.", "...eeeeeeee..."],
    day: { e: "#4A8FBC", W: "#63AED6", h: "#B4DCF5" },
    night: { e: "#22395A", W: "#304D73", h: "#46689A" },
  },
  heartLantern: {
    rows: ["KKKKKKKK.", "KW....K..", "KW.rr.rr.", "KW.rRrrr.", "KW..rrr..", "KW...r...", "KW.......", "KW.......", "KW.......", "KW.......", "KW.......", "KKK......"],
    day: { K, W: "#C98148", r: "#FF6F9C", R: "#FFC2D6" },
    night: { K: KN, W: "#4B3328", r: "#FF8FBA", R: "#FFE9F0" },
  },
  garland: {
    rows: [".yy..ww..pp..yy..ww..pp.", "yoyywowwpoppyoyywowwpopp", ".yy..ww..pp..yy..ww..pp."],
    day: { y: "#FFD84A", o: "#F58A1F", w: "#FFFDF5", p: "#FF8FBA" },
    night: { y: "#E9C23C", o: "#C9620F", w: "#D9D2C0", p: "#D97FA6" },
  },
  bucket: {
    rows: [".K....K.", "K.KKKK.K", "KKKKKKKK", "KbwwwwbK", "KbbbbbbK", ".KbBbbK.", ".KbbbbK.", "..KKKK.."],
    day: { K, b: "#9AA1AE", B: "#5C6370", w: "#63AED6" },
    night: { K: KN, b: "#5A6070", B: "#3A3F4C", w: "#304D73" },
  },
  clockTower: {
    rows: [
      "....KKKK....",
      "...KRRRRK...",
      "..KRRRRRRK..",
      ".KKKKKKKKKK.",
      ".KCCCCCCCCK.",
      ".KCCKKKKCCK.",
      ".KCKWWkWKCK.",
      ".KCKWkkWKCK.",
      ".KCKWWWWKCK.",
      ".KCCKKKKCCK.",
      ".KCCCCCCCCK.",
      ".KCCCCCCCCK.",
      ".KCCCDDCCCK.",
      ".KCCCDDCCCK.",
      ".KKKKKKKKKK.",
    ],
    day: { K, R: "#EF6D64", C: "#FFF0D5", W: "#FFFFFF", k: "#21191B", D: "#C98148" },
    night: { K: KN, R: "#7A3F58", C: "#4D477B", W: "#FFE9A8", k: "#21191B", D: "#5A3A2C" },
  },
  bat: {
    rows: ["K.......K", "KK.KKK.KK", "KKKKKKKKK", ".KK.K.KK.", "....K...."],
    day: { K: "#3A2A4A" },
    night: { K: "#0F0C14" },
  },
  // --- Sakura Festival ---
  sakuraTree: {
    rows: [
      ".....KKKKKKK......",
      "...KKpwppwppKK....",
      "..KpwppPpppwppK...",
      ".KppPppwppPpppwK..",
      "KpwpppppPppwpppPK.",
      "KppPpwppppppPpppK.",
      "KpppppPpwppppwppPK",
      "KPpwppppppPppppppK",
      ".KppppPpppppwpPpK.",
      ".KKpPppwpPpppppKK.",
      "...KKKpppppPKKK...",
      "......KTtTK.......",
      ".......KTtK.......",
      ".......KTtK.......",
      ".......KTtK.......",
      "......KTTtTK......",
      "......KKKKKK......",
    ],
    day: { K: "#261D22", p: "#F4A6C5", P: "#D978A5", w: "#FFD7E5", T: "#634435", t: "#9A684B" },
    night: { K: KN, p: "#E89ABD", P: "#B8668F", w: "#FFC4D9", T: "#2E2230", t: "#4B3328" },
  },
  sakuraBranch: {
    rows: [
      "TTTt..................",
      ".TTTTt...ppw..........",
      "...TTTTtpPppp.........",
      ".....tTTTTppw..pp.....",
      "..ppw...tTTTTtppPp....",
      ".pPppp.....tTTTTTt....",
      "..ppw....pp....tTTt.pp",
      "........pPpp.....tTtpP",
      ".........pp........tpp",
    ],
    day: { p: "#F4A6C5", P: "#D978A5", w: "#FFD7E5", T: "#634435", t: "#9A684B" },
    night: { p: "#E89ABD", P: "#B8668F", w: "#FFC4D9", T: "#2E2230", t: "#4B3328" },
  },
  sakuraLantern: {
    rows: [
      "KKKKKKK..",
      "KW...K...",
      "KW..KKK..",
      "KW.KrRrK.",
      "KW.KRRRK.",
      "KW.KrRrK.",
      "KW..KKK..",
      "KW...y...",
      "KW...y...",
      "KW.......",
      "KW.......",
      "KW.......",
      "KW.......",
      "KKK......",
    ],
    day: { K, W: "#9A684B", r: "#F4A6C5", R: "#FFD7E5", y: "#FFD84A" },
    night: { K: KN, W: "#4B3328", r: "#FFBE71", R: "#FFF1C6", y: "#FFBE71" },
  },
  petalPatch: {
    rows: ["p..w...p..", "..p..p...w", ".w..p..p..", "p....w...p"],
    day: { p: "#F4A6C5", w: "#FFD7E5" },
    night: { p: "#E89ABD", w: "#FFC4D9" },
  },
  picnicBlanket: {
    rows: ["KKKKKKKKKKKKKKKK", "KpwpwpwpwpwpwpwK", "KwpwpwpwpwpwpwpK", "KpwpwpwpwpwpwpwK", "KwpwpwpwpwpwpwpK", "KKKKKKKKKKKKKKKK"],
    day: { K, p: "#F4A6C5", w: "#FFF2E5" },
    night: { K: KN, p: "#B8668F", w: "#B9AEC9" },
  },
  basket: {
    rows: ["..KKKK..", ".K....K.", "KKKKKKKK", "KbBbBbBK", "KBbBbBbK", "KbBbBbBK", ".KKKKKK."],
    day: { K, b: "#C98148", B: "#9A684B" },
    night: { K: KN, b: "#6B4A3A", B: "#4B3328" },
  },
  teaSet: {
    rows: [".KKK......", "KgggKK.KKK", "KggggK.KcK", "KggggK.KKK", ".KKKK....."],
    day: { K, g: "#8FBF8A", c: "#FFF2E5" },
    night: { K: KN, g: "#4E7F4A", c: "#B9AEC9" },
  },
  bench: {
    rows: ["KKKKKKKKKKKK", "KwwwwwwwwwwK", "KKKKKKKKKKKK", ".KW......WK.", ".KW......WK.", ".KK......KK."],
    day: { K, w: "#C98148", W: "#9A684B" },
    night: { K: KN, w: "#6B4A3A", W: "#4B3328" },
  },
  teaStand: {
    rows: [
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
      ".KrrwwrrwwrrwwrrwwrrwwrrwwK.",
      "KrrwwrrwwrrwwrrwwrrwwrrwwrrK",
      "KRRWWRRWWRRWWRRWWRRWWRRWWRRK",
      "KKKKKKKKKKKKKKKKKKKKKKKKKKKK",
      "..KP........L.L.........PK..",
      "..KP....................PK..",
      "..KP..ff..gg..bb..ff..gg.PK.",
      "..KP..ff..gg..bb..ff..gg.PK.",
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
      "..KTtTTTTtTTTTTtTTTTtTTTTK..",
      "..KTTTTTTTTTTTTTTTTTTTTTTK..",
      "..KTTtTTTTTtTTTTTtTTTTTtTK..",
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
    ],
    day: { K, r: "#F4A6C5", R: "#D978A5", w: "#FFF2E5", W: "#EBD5BC", P: "#9A684B", T: "#9A684B", t: "#C98148", L: "#FFD84A", f: "#8FBF8A", g: "#FFF2E5", b: "#F4A6C5" },
    night: { K: KN, r: "#B8668F", R: "#8A4A6E", w: "#B9AEC9", W: "#8F86A3", P: "#4B3328", T: "#4B3328", t: "#6B4A3A", L: "#FFF1C6", f: "#4E7F4A", g: "#B9AEC9", b: "#E89ABD" },
  },
  // --- Loy Krathong ---
  krathongStall: {
    rows: [
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
      ".KrrwwrrwwrrwwrrwwrrwwrrwwK.",
      "KrrwwrrwwrrwwrrwwrrwwrrwwrrK",
      "KRRWWRRWWRRWWRRWWRRWWRRWWRRK",
      "KKKKKKKKKKKKKKKKKKKKKKKKKKKK",
      "..KP........L.L.........PK..",
      "..KP....................PK..",
      "..KP..ff..gg..bb..ff..gg.PK.",
      "..KP..ff..gg..bb..ff..gg.PK.",
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
      "..KTtTTTTtTTTTTtTTTTtTTTTK..",
      "..KTTTTTTTTTTTTTTTTTTTTTTK..",
      "..KTTtTTTTTtTTTTTtTTTTTtTK..",
      "..KKKKKKKKKKKKKKKKKKKKKKKK..",
    ],
    day: { K, r: "#8A5CD6", R: "#6B4AA8", w: "#FFD84A", W: "#E9A92C", P: "#9A684B", T: "#9A684B", t: "#C98148", L: "#FFE9A8", f: "#FF8FBA", g: "#F4F1FF", b: "#F2B01E" },
    night: { K: KN, r: "#5A3F8C", R: "#3F2C66", w: "#FFBE67", W: "#C98A3C", P: "#4B3328", T: "#4B3328", t: "#6B4A3A", L: "#FFF1C6", f: "#FF8FBA", g: "#D8C4FF", b: "#FFD84A" },
  },
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;

export function sprite(name: SpriteName, night: boolean): PixelImage {
  const { rows, day, night: dark } = SPRITES[name];
  return pixelArt(rows, night ? dark : day, `sprite:${name}:${night}`);
}

/** A seamless strip of stepped mountains with snow caps. */
export function mountains(night: boolean): PixelImage {
  const width = 120;
  const height = 34;
  const peaks = [
    { x: 14, h: 26 },
    { x: 43, h: 33 },
    { x: 70, h: 22 },
    { x: 96, h: 30 },
  ];
  // Distance wraps around, so the strip can repeat without a seam.
  const peakAt = (x: number) =>
    peaks
      .map((peak) => {
        const distance = Math.min(Math.abs(x - peak.x), width - Math.abs(x - peak.x));
        return { top: peak.h - distance * 1.4, lit: x <= peak.x, height: peak.h };
      })
      .sort((a, b) => b.top - a.top)[0];

  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const peak = peakAt(x);
      const top = Math.max(4, Math.round(peak.top / 2) * 2); // steps of 2 for a chunky outline
      const level = height - y;
      if (level > top) return ".";
      if (level > top - 4 && top > 22) return "N";
      return peak.lit ? "M" : "m";
    }).join(""),
  );
  return pixelArt(rows, night ? { M: "#2F3668", m: "#242954", N: "#6A6FA8" } : { M: "#8FB8E0", m: "#789FCB", N: "#FFF1DB" }, `mountains:${night}`);
}

/** A pond with a stepped, pixel-art shoreline. */
export function pond(night: boolean): PixelImage {
  const width = 72;
  const height = 26;
  const inside = (x: number, y: number, grow = 0) =>
    ((x + 0.5 - width / 2) / (width / 2 + grow)) ** 2 + ((y + 0.5 - height / 2) / (height / 2 + grow)) ** 2 <= 1;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (!inside(x, y)) return ".";
      if (!inside(x, y, -1.2)) return "K";
      if (!inside(x, y, -2.6)) return "e";
      return (x * 7 + y * 13) % 29 < 4 && y % 3 === 0 ? "h" : "W";
    }).join(""),
  );
  return pixelArt(rows, night ? { K: KN, e: "#22395A", W: "#304D73", h: "#46689A" } : { K, e: "#4A8FBC", W: "#63AED6", h: "#9FD8F5" }, `pond:${night}`);
}

/**
 * A long racing boat full of paddling ducks, as a two-frame sprite sheet (paddles forward, paddles back).
 * `hull` is the boat's team color.
 */
export function racingBoat(hull: string, night: boolean): PixelImage & { frames: number } {
  const width = 60;
  const height = 14;
  const seats = [9, 16, 23, 30, 37, 44];
  const frame = (paddlesBack: boolean) => {
    const grid = Array.from({ length: height }, () => Array<string>(width).fill("."));
    const put = (x: number, y: number, char: string) => {
      if (x >= 0 && x < width && y >= 0 && y < height) grid[y][x] = char;
    };
    for (let x = 4; x <= 55; x++) {
      put(x, 8, "h");
      put(x, 9, "H");
    }
    for (let x = 5; x <= 54; x++) put(x, 10, "H");
    for (let x = 6; x <= 53; x++) put(x, 11, "K");
    // Raised stern on the left, and a golden prow on the right.
    [[3, 8], [2, 7], [1, 6], [0, 5]].forEach(([x, y]) => put(x, y, "H"));
    [[56, 8], [57, 7], [58, 6], [59, 5], [59, 4], [58, 4]].forEach(([x, y]) => put(x, y, "G"));
    for (const x of seats) {
      put(x, 5, "D");
      put(x + 1, 5, "D");
      put(x, 6, "D");
      put(x + 1, 6, "D");
      put(x + 2, 6, "O");
      put(x, 7, "S");
      put(x + 1, 7, "S");
      const blade = paddlesBack ? [[x - 1, 9], [x - 2, 10], [x - 3, 11], [x - 3, 12]] : [[x + 3, 9], [x + 4, 10], [x + 4, 11], [x + 4, 12]];
      blade.forEach(([px, py]) => put(px, py, "P"));
    }
    return grid.map((row) => row.join(""));
  };
  const colors = night
    ? { K: KN, H: hull, h: "#FFE9A8", G: "#FFBE67", D: "#D9B43C", O: "#C9620F", S: "#F6E7CF", P: "#8A6A50" }
    : { K, H: hull, h: "#FFF1DB", G: "#FFD84A", D: "#FFD84A", O: "#F58A1F", S: "#FFF1DB", P: "#A8693C" };
  return { ...pixelArt([frame(false), frame(true)], colors, `boat:${hull}:${night}`), frames: 2 };
}

/** A small pixel firework: a spark that opens into a ring and fades, with long dark pauses between. */
export function firework(color: string): PixelImage & { frames: number } {
  const size = 17;
  const center = 8;
  const ring = (radius: number, points: number, char: string) => {
    const grid = Array.from({ length: size }, () => Array<string>(size).fill("."));
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      grid[Math.round(center + Math.sin(angle) * radius)][Math.round(center + Math.cos(angle) * radius)] = char;
    }
    return grid.map((row) => row.join(""));
  };
  const empty = ring(0, 0, ".");
  const frames = [ring(0, 1, "w"), ring(2, 8, "c"), ring(5, 12, "c"), ring(7, 12, "f"), empty, empty, empty, empty, empty, empty];
  return { ...pixelArt(frames, { w: "#FFFFFF", c: color, f: `${color}88` }, `firework:${color}`), frames: frames.length };
}

// Particle tiles: a small square of scattered pixels that repeats across the screen and scrolls.
// One element per effect, however many flakes or drops it shows.
const TILE = 24;
const scatter = (pixels: [number, number, string][]) => {
  const grid = Array.from({ length: TILE }, () => Array<string>(TILE).fill("."));
  for (const [x, y, char] of pixels) grid[y % TILE][x % TILE] = char;
  return grid.map((row) => row.join(""));
};
/** A tiny shape stamped at several places. */
const stamp = (shape: string[], spots: [number, number][], recolor?: (i: number) => string) =>
  scatter(spots.flatMap(([x, y], i) => shape.flatMap((row, dy) => [...row].flatMap((char, dx) => (char === "." ? [] : [[x + dx, y + dy, recolor?.(i) ?? char] as [number, number, string]])))));

const PARTICLE_TILES: Record<string, { rows: string[]; colors: Colors }> = {
  snow: { rows: stamp(["w"], [[2, 1], [14, 4], [8, 9], [20, 12], [4, 16], [16, 20], [11, 2], [22, 22]]), colors: { w: "#FFFFFF" } },
  rain: { rows: stamp(["b", "b", "b"], [[3, 0], [15, 4], [9, 11], [21, 15], [6, 19]]), colors: { b: "#BFE2F5" } },
  hearts: { rows: stamp(["p.p", "ppp", ".p."], [[3, 2], [15, 13]]), colors: { p: "#FF6F9C" } },
  confetti: { rows: stamp(["c"], [[2, 1], [9, 5], [17, 3], [5, 12], [13, 15], [21, 10], [8, 21], [19, 19]], (i) => "rybg"[i % 4]), colors: { r: "#EF6D64", y: "#FFD84A", b: "#6FB4F2", g: "#7FD66B" } },
  sparkles: { rows: stamp([".y.", "yyy", ".y."], [[4, 3], [17, 14]]), colors: { y: "#FFF3A6" } },
  fireflies: { rows: stamp(["y"], [[3, 5], [12, 17], [20, 8]]), colors: { y: "#FFE98A" } },
  petals: { rows: stamp(["p.", ".p"], [[2, 3], [13, 9], [20, 18], [7, 20]]), colors: { p: "#FFB3D1" } },
  flowers: { rows: stamp([".w.", "wyw", ".w."], [[3, 4], [16, 15]]), colors: { w: "#FFFDF5", y: "#FFD84A" } },
  "falling-leaves": { rows: stamp(["oo", ".o"], [[3, 2], [14, 10], [20, 19]]), colors: { o: "#F58A1F" } },
  "water-splash": { rows: stamp(["b"], [[2, 3], [10, 8], [18, 2], [6, 15], [15, 18], [22, 12]]), colors: { b: "#9FD8F5" } },
};

export type ParticleTileName = keyof typeof PARTICLE_TILES;
export const hasParticleTile = (name: string) => name in PARTICLE_TILES;

/** `sparse` gives the same pixels on a tile twice as large, so the effect is four times thinner. */
export function particleTile(name: string, sparse = false): PixelImage | null {
  const tile = PARTICLE_TILES[name];
  if (!tile) return null;
  const empty = ".".repeat(TILE * 2);
  const rows = sparse ? [...tile.rows.map((row) => row.padEnd(TILE * 2, ".")), ...Array<string>(TILE).fill(empty)] : tile.rows;
  return pixelArt(rows, tile.colors, `particle:${name}:${sparse}`);
}

/** A cherry blossom petal turning as it falls: four frames, in a pink or a pale shade. */
export function sakuraPetal(pale: boolean, night: boolean): PixelImage & { frames: number } {
  const frames = [
    [".pp..", "pppp.", ".ppp.", "..p..", "....."],
    ["..p..", ".ppp.", ".ppp.", "..p..", "....."],
    [".....", "pppp.", ".pp..", ".....", "....."],
    ["..p..", ".pp..", "pppp.", ".pp..", "....."],
  ];
  const color = pale ? (night ? "#FFC4D9" : "#FFD7E5") : night ? "#E89ABD" : "#F4A6C5";
  return { ...pixelArt(frames, { p: color }, `petal:${pale}:${night}`), frames: frames.length };
}
