// Hindi in Devanagari, written the way people type Hinglish in Roman
// letters: "इस फ़िल्म में लोगो को धीरे धीरे बड़ा करो" becomes "is film mein
// logo ko dheere dheere bada karo". Runs on this Mac, the same way every
// time: a letter map, the usual dropping of the silent "a" (karna, not
// karana), and a short list of everyday words people spell their own way.
// Words already in Roman letters pass through untouched.
//
// It can't know an English word that whisper wrote in Devanagari
// ("बैकग्राउंड" comes out "baikagraund"); the Hinglish speech model, which
// writes Roman letters itself, is the fix for that (dictation.ts).

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "f", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h",
  ळ: "l",
};
// With a nukta (the dot below), as one letter or as letter + dot.
const NUKTA: Record<string, string> = { क: "q", ख: "kh", ग: "g", ज: "z", ड: "d", ढ: "rh", फ: "f", य: "y", र: "r" };
const PRECOMPOSED: Record<string, string> = { "क़": "क", "ख़": "ख", "ग़": "ग", "ज़": "ज", "ड़": "ड", "ढ़": "ढ", "फ़": "फ", "य़": "य" };

const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e",
};
// Vowel signs after a consonant. ी and ू depend on where they fall (below).
const SIGNS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
};
const VIRAMA = "्";
const NUKTA_SIGN = "़";
const NASAL = new Set(["ं", "ँ"]); // anusvara, chandrabindu
const VISARGA = "ः";

// Everyday words people spell their own way.
const WORDS: Record<string, string> = {
  में: "mein", मैं: "main", हैं: "hain", है: "hai", नहीं: "nahi", नही: "nahi", यह: "yeh", वह: "woh", ये: "ye", वो: "wo",
  और: "aur", क्या: "kya", क्यों: "kyon", हूँ: "hoon", हूं: "hoon", हाँ: "haan", हां: "haan", कहाँ: "kahan", यहाँ: "yahan",
  वहाँ: "wahan", ठीक: "theek", तो: "toh", भी: "bhi", एक: "ek", दो: "do", कुछ: "kuch", सब: "sab", अब: "ab", जब: "jab",
  तब: "tab", कब: "kab", थोड़ा: "thoda", ज़्यादा: "zyada", ज्यादा: "zyada", चाहिए: "chahiye", लिए: "liye", किए: "kiye",
  दिए: "diye", गए: "gaye", हुए: "hue", आप: "aap", हम: "hum", तुम: "tum", मुझे: "mujhe", उसे: "use", इसे: "ise",
  करें: "karein", रहें: "rahein", जाएं: "jayen", वाला: "wala", वाले: "wale", वाली: "wali",
};

type Unit = { out: string; sign: string | null; own: boolean; schwa: boolean; nasal: boolean; cluster: boolean; last: string };

function word(w: string): string {
  if (WORDS[w]) return WORDS[w];
  // Each letter, with whether it carries a nukta (as one letter or two).
  const chars = [...w.normalize("NFC")];
  const units: Unit[] = [];
  let i = 0;
  while (i < chars.length) {
    const raw = chars[i];
    const base = PRECOMPOSED[raw] ?? raw;
    if (CONSONANTS[base]) {
      let dotted = base !== raw;
      if (chars[i + 1] === NUKTA_SIGN) {
        dotted = true;
        i++;
      }
      const unit: Unit = { out: dotted ? (NUKTA[base] ?? CONSONANTS[base]) : CONSONANTS[base], sign: null, own: false, schwa: false, nasal: false, cluster: false, last: base };
      const next = chars[i + 1];
      if (next === VIRAMA) {
        unit.cluster = true;
        i += 2;
      } else if (next !== undefined && SIGNS[next] !== undefined) {
        unit.sign = next;
        i += 2;
      } else {
        unit.schwa = true;
        i += 1;
      }
      while (chars[i] !== undefined && (NASAL.has(chars[i]) || chars[i] === VISARGA)) {
        if (chars[i] === VISARGA) unit.out += unit.schwa ? "ah" : "h";
        else unit.nasal = true;
        i++;
      }
      units.push(unit);
    } else if (VOWELS[base]) {
      const unit: Unit = { out: VOWELS[base], sign: null, own: true, schwa: false, nasal: false, cluster: false, last: base };
      i++;
      while (chars[i] !== undefined && NASAL.has(chars[i])) {
        unit.nasal = true;
        i++;
      }
      units.push(unit);
    } else {
      // Anything else (a stray sign) is dropped.
      i++;
    }
  }

  // The silent "a". At the end of a word it goes ("rang", "film"), except
  // in a one-letter word or after a cluster ending in r, y or v ("mitra",
  // "karya"). Inside a word it goes between a sounded letter and a
  // consonant with its own vowel ("karana" -> "karna"), right to left.
  const n = units.length;
  const dropped = new Set<number>();
  const end = units[n - 1];
  if (n > 1 && end.schwa && !end.nasal && !(units[n - 2].cluster && "रयव".includes(end.last))) dropped.add(n - 1);
  const sounded = (k: number) => {
    const u = units[k];
    return u !== undefined && !u.cluster && (u.own || u.sign !== null || (u.schwa && !dropped.has(k)));
  };
  for (let k = n - 2; k >= 1; k--) {
    const u = units[k];
    if (!u.schwa || u.nasal) continue;
    if (sounded(k - 1) && !units[k + 1].own && sounded(k + 1)) dropped.add(k);
  }

  let text = "";
  units.forEach((u, k) => {
    text += u.out;
    if (u.sign !== null) {
      let v = SIGNS[u.sign];
      // ी and ू are "i" and "u" at the end of a word, "ee" and "oo" inside.
      if (k === n - 1 && v === "ee") v = "i";
      if (k === n - 1 && v === "oo") v = "u";
      // A long "a" closed by the last letter stays long: "kaam", "baad".
      if (v === "a" && k === n - 2 && dropped.has(n - 1)) v = "aa";
      text += v;
    } else if (u.schwa && !dropped.has(k)) {
      text += "a";
    }
    if (u.nasal) text += "n";
  });
  return text;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const DIGITS = "०१२३४५६७८९";

// Writes every Devanagari word in Roman letters; everything else stays.
export function toRoman(text: string): string {
  if (!DEVANAGARI.test(text)) return text;
  let out = text
    .replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)))
    .replace(/\s*[।॥]/g, ".")
    .replace(/[ऀ-ॿ]+/g, (w) => word(w));
  // A sentence that started in Devanagari starts with a capital.
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  return out;
}

export const hasDevanagari = (text: string) => DEVANAGARI.test(text);
