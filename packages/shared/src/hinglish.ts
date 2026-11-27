const WORD_MAP: Array<[RegExp, string]> = [
  [/चांदी|चाँदी/g, 'chandi'],
  [/सोना/g, 'sona'],
  [/पेटी/g, 'peti'],
  [/चोरसा/g, 'chorsa'],
  [/रवा/g, 'rawa'],
  [/बदला/g, 'badla'],
  [/पक्की/g, 'pakki'],
  [/पक्का/g, 'pakka'],
  [/कच्ची/g, 'kacchi'],
  [/कच्चा/g, 'kaccha'],
  [/बढ़ाओ/g, 'badhao'],
  [/बढ़ा/g, 'badha'],
  [/घटाओ/g, 'ghatao'],
  [/घटा/g, 'ghata'],
  [/कम/g, 'kam'],
  [/फ्रीज/g, 'freeze'],
  [/बंद/g, 'band'],
  [/चालू/g, 'chalu'],
  [/खोलो/g, 'kholo'],
  [/भाव/g, 'bhaav'],
  [/रेट/g, 'rate'],
  [/हिसाब/g, 'hisab'],
  [/बैलेंस/g, 'balance'],
  [/कर दो/g, 'kar do'],
  [/करो/g, 'karo'],
  [/रुपये|रुपए|रु/g, 'rupaye'],
  [/खरीदो/g, 'khareedo'],
  [/बेचो/g, 'becho'],
  [/ग्राम/g, 'gram'],
  [/किलो/g, 'kilo'],
  [/तोला/g, 'tola'],
  [/स्प्रेड/g, 'spread'],
  [/एक/g, 'ek'],
  [/दो/g, 'do'],
  [/तीन/g, 'teen'],
  [/चार/g, 'char'],
  [/पांच|पाँच/g, 'paanch'],
  [/छह|छः/g, 'chhe'],
  [/सात/g, 'saat'],
  [/आठ/g, 'aath'],
  [/नौ/g, 'nau'],
  [/दस/g, 'dus'],
  [/बीस/g, 'bees'],
  [/पच्चीस/g, 'pachees'],
  [/तीस/g, 'tees'],
  [/पचास/g, 'pachas'],
  [/सौ/g, 'sau'],
  [/हजार|हज़ार/g, 'hazar'],
  [/डेढ़|डेढ/g, 'dedh'],
  [/ढाई/g, 'dhai'],
  [/साढ़े|साढे/g, 'sadhe'],
  [/सवा/g, 'sawa'],
  [/पौने/g, 'paune'],
];

const VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'ee',
  उ: 'u',
  ऊ: 'oo',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
};

const MATRAS: Record<string, string> = {
  'ा': 'a',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ं': 'n',
  'ँ': 'n',
  'ः': 'h',
};

const CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'ny',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h',
  क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f',
};

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

/**
 * Transliterates any Devanagari Hindi text into readable Hinglish (Latin script)
 * while preserving existing English/Latin text and numbers.
 */
export function transliterateDevanagariToHinglish(input: string): string {
  // Normalize nukta-decomposed characters before transliterating
  let text = input.replace(/़/g, '');

  // 1. Replace common bullion/Hindi vocabulary cleanly first
  for (const [pattern, replacement] of WORD_MAP) {
    text = text.replace(pattern, replacement);
  }

  // 2. Fallback character-by-character transliteration for any remaining Devanagari
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DEVANAGARI_DIGITS[ch]) {
      out += DEVANAGARI_DIGITS[ch];
      continue;
    }
    if (VOWELS[ch]) {
      out += VOWELS[ch];
      continue;
    }
    if (CONSONANTS[ch]) {
      const next = text[i + 1];
      if (next === '्') {
        // Halant suppresses inherent 'a'
        out += CONSONANTS[ch];
        i++;
      } else if (next && MATRAS[next]) {
        out += CONSONANTS[ch] + MATRAS[next];
        i++;
      } else {
        // Inherent 'a' unless at end of word
        const isWordEnd = !next || /\s|[.,!?]/.test(next);
        out += CONSONANTS[ch] + (isWordEnd ? '' : 'a');
      }
      continue;
    }
    if (MATRAS[ch]) {
      out += MATRAS[ch];
      continue;
    }
    if (ch === '्' || ch === '़') {
      continue;
    }
    out += ch;
  }

  return out.replace(/\s+/g, ' ').trim();
}

const BASE_HINDI_NUMS: Record<string, number> = {
  shunya: 0, zero: 0,
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, four: 4,
  paanch: 5, panch: 5, five: 5, chhe: 6, che: 6, six: 6, saat: 7, seven: 7,
  aath: 8, eight: 8, nau: 9, nine: 9, das: 10, dus: 10, ten: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15,
  solah: 16, satrah: 17, atharah: 18, unnees: 19, bees: 20,
  ikkees: 21, bais: 22, teis: 23, chaubis: 24, pachees: 25, pachchis: 25,
  chhabbees: 26, sattais: 27, atthais: 28, untees: 29, tees: 30,
  ikattees: 31, battees: 32, tentees: 33, chautees: 34, paintees: 35,
  chhattees: 36, saintees: 37, adtees: 38, untalis: 39, chalis: 40,
  iktalis: 41, bayalis: 42, taintalis: 43, chawalis: 44, paintalis: 45,
  chhiyalis: 46, saintalis: 47, adtalis: 48, unchas: 49, pachas: 50,
  ikyawan: 51, bawan: 52, tirpan: 53, chauwan: 54, pachpan: 55,
  chhappan: 56, sattawan: 57, atthawan: 58, unsath: 59, saath: 60,
  iksath: 61, basath: 62, tirsath: 63, chausath: 64, painsath: 65,
  chhiyasath: 66, sarsath: 67, adsath: 68, unhattar: 69, sattar: 70,
  ikhattar: 71, bahattar: 72, tihattar: 73, chauhattar: 74, pachhattar: 75,
  chhihattar: 76, satattar: 77, athattar: 78, unasi: 79, assi: 80,
  ikyasi: 81, bayasi: 82, tirasi: 83, chaurasi: 84, pachasi: 85,
  chhiyasi: 86, sattasi: 87, atthasi: 88, nawasi: 89, nabbe: 90,
  ikyanwe: 91, banwe: 92, tiranwe: 93, chauranwe: 94, pachanwe: 95,
  chhiyanwe: 96, sattanwe: 97, atthanwe: 98, ninyanwe: 99,
};

const MULTIPLIERS: Record<string, number> = {
  sau: 100, hundred: 100,
  hazar: 1000, hajaar: 1000, thousand: 1000,
  lakh: 100000,
};

/**
 * Generic algorithmic parser that converts spoken Hindi/English number phrases
 * (e.g. "pachpan", "do sau pachas", "dedh sau", "sadhe teen") into digits.
 */
export function replaceHindiNumbers(input: string): string {
  const tokens = input.split(/\s+/);
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];

    // Fractional prefixes: dedh (1.5), dhai (2.5), sadhe X (X + 0.5)
    if (t === 'dedh' || t === 'dedha') {
      const mult = MULTIPLIERS[tokens[i + 1] ?? ''];
      if (mult) {
        out.push(String(1.5 * mult));
        i += 2;
      } else {
        out.push('1.5');
        i += 1;
      }
      continue;
    }
    if (t === 'dhai') {
      const mult = MULTIPLIERS[tokens[i + 1] ?? ''];
      if (mult) {
        out.push(String(2.5 * mult));
        i += 2;
      } else {
        out.push('2.5');
        i += 1;
      }
      continue;
    }
    if (t === 'sadhe' && tokens[i + 1] && BASE_HINDI_NUMS[tokens[i + 1]] !== undefined) {
      const base = BASE_HINDI_NUMS[tokens[i + 1]] + 0.5;
      const mult = MULTIPLIERS[tokens[i + 2] ?? ''];
      if (mult) {
        out.push(String(base * mult));
        i += 3;
      } else {
        out.push(String(base));
        i += 2;
      }
      continue;
    }

    // Standard number phrase accumulation (e.g. "do hazar paanch sau pachas")
    if (BASE_HINDI_NUMS[t] !== undefined || MULTIPLIERS[t] !== undefined) {
      let total = 0;
      let current = 0;
      let consumed = false;

      while (i < tokens.length) {
        const tok = tokens[i];
        if (BASE_HINDI_NUMS[tok] !== undefined) {
          current += BASE_HINDI_NUMS[tok];
          consumed = true;
          i++;
        } else if (MULTIPLIERS[tok] !== undefined) {
          const m = MULTIPLIERS[tok];
          current = (current === 0 ? 1 : current) * m;
          if (m >= 1000) {
            total += current;
            current = 0;
          }
          consumed = true;
          i++;
        } else {
          break;
        }
      }
      if (consumed) {
        out.push(String(total + current));
        continue;
      }
    }

    out.push(t);
    i++;
  }

  return out.join(' ');
}
