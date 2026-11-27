import { describe, expect, it } from 'vitest';
import { replaceHindiNumbers, transliterateDevanagariToHinglish } from './hinglish.js';

describe('transliterateDevanagariToHinglish', () => {
  it('converts Devanagari bullion phrases into clean Hinglish', () => {
    expect(transliterateDevanagariToHinglish('दस पेटी चांदी पक्की कर दो')).toBe(
      'dus peti chandi pakki kar do'
    );
    expect(transliterateDevanagariToHinglish('गोल्ड 995 पचास रुपये बढ़ाओ')).toBe(
      'gold 995 pachas rupaye badhao'
    );
  });

  it('preserves existing English/Hinglish text', () => {
    expect(transliterateDevanagariToHinglish('2 peti chandi RTGS')).toBe('2 peti chandi RTGS');
  });
});

describe('replaceHindiNumbers', () => {
  it('parses arbitrary Hindi numbers and compound multipliers', () => {
    expect(replaceHindiNumbers('pachpan peti chandi')).toBe('55 peti chandi');
    expect(replaceHindiNumbers('do sau pachas badha')).toBe('250 badha');
    expect(replaceHindiNumbers('dedh sau kam')).toBe('150 kam');
    expect(replaceHindiNumbers('ek hazar do sau rupaye')).toBe('1200 rupaye');
    expect(replaceHindiNumbers('sadhe teen kg')).toBe('3.5 kg');
  });
});
