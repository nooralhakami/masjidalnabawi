import { describe, expect, it } from 'vitest';
import { I18N, POIS, POI_BY_ID } from '../../src/data';
import type { LangCode, Poi } from '../../src/data';
import { LANGS, ds, latinDigits, nm, t } from '../../src/i18n';
import { EXTRA_UI } from '../../src/i18n/strings';
import { LANDING_UI } from '../../src/i18n/landing-strings';
import { FILTERS, TOILET_SUBS } from '../../src/domain/filters';

const P = (id: number): Poi => POI_BY_ID.get(id)!;

describe('translations are complete', () => {
  it('every data UI key exists in all six languages', () => {
    const keys = Object.keys(I18N.ar.ui).sort();
    for (const l of LANGS) expect(Object.keys(I18N[l].ui).sort(), l).toEqual(keys);
  });

  it('every added UI key exists in all six languages and is non-empty', () => {
    const keys = Object.keys(EXTRA_UI.ar).sort();
    for (const l of LANGS) {
      expect(Object.keys(EXTRA_UI[l]).sort(), l).toEqual(keys);
      for (const k of keys) expect(EXTRA_UI[l][k].trim(), `${l}.${k}`).not.toBe('');
    }
  });

  it('every landing key exists in all six languages, with matching placeholders', () => {
    const keys = Object.keys(LANDING_UI.ar).sort();
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const l of LANGS) {
      expect(Object.keys(LANDING_UI[l]).sort(), l).toEqual(keys);
      for (const k of keys) {
        expect(LANDING_UI[l][k].trim(), `${l}.${k}`).not.toBe('');
        expect(ph(LANDING_UI[l][k]), `${l}.${k}`).toBe(ph(LANDING_UI.ar[k]));
      }
    }
  });

  it('added keys never collide with data keys', () => {
    for (const k of [...Object.keys(EXTRA_UI.ar), ...Object.keys(LANDING_UI.ar)]) expect(I18N.ar.ui[k], k).toBeUndefined();
  });

  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(EXTRA_UI.ar)) {
      for (const l of LANGS) expect(ph(EXTRA_UI[l][k]), `${l}.${k}`).toBe(ph(EXTRA_UI.ar[k]));
    }
  });

  it('every filter label resolves in every language', () => {
    for (const l of LANGS) {
      for (const f of [...FILTERS, ...TOILET_SUBS]) expect(t(f.label, undefined, l), `${l}.${f.label}`).not.toBe(f.label);
    }
  });

  it('every POI has a translated name and description in every non-Arabic language', () => {
    for (const l of LANGS.filter((x) => x !== 'ar') as LangCode[]) {
      for (const p of POIS) {
        // Each name comes from a translation source: a named entry or a per-type template.
        // (Comparing with Arabic fails for "KFC", or Urdu loanwords written the same way.)
        const L = I18N[l];
        const key = p.category === 'emergency' ? 'emergency' : p.subCategory;
        const hasSource = Boolean(L.names?.[p.name_ar] || L.nt?.[key] || (p.subCategory === 'gate_inner' && L.gi?.[p.id]));
        expect(hasSource, `${l} name ${p.id}`).toBe(true);
        expect(nm(p, l).length, `${l} name ${p.id}`).toBeGreaterThan(1);
        expect(ds(p, l).length, `${l} desc ${p.id}`).toBeGreaterThan(3);
      }
    }
  });
});

describe('names and descriptions', () => {
  it('templated names keep Latin digits and local numbering', () => {
    expect(nm(P(301), 'en')).toBe('Gate 301');
    expect(nm(P(905), 'en')).toBe('Parking No. 5');
    expect(nm(P(401), 'en')).toContain('1');
    expect(nm(P(604), 'en')).toMatch(/Rawdah/);
    expect(nm(P(37), 'en')).toBe('Bab Makkah – Gate 37 (Rawdah entrance)');
    expect(nm(P(215), 'ur')).toMatch(/215/);
  });

  it('parking description fills in its facility pairs', () => {
    expect(ds(P(901), 'en')).toContain('201/202');
    expect(ds(P(901), 'en')).toContain('203/204');
  });

  it('women-section inner gates mention it', () => {
    expect(ds(P(11), 'en')).toMatch(/women/i);
  });

  it('strips emoji from data strings', () => {
    expect(ds(P(215), 'ar')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(t('p_all', undefined, 'ar')).toBe('الكل');
    expect(t('alt', { id: 217, m: 65 }, 'ar')).toContain('217');
  });

  it('Arabic-Indic digits become Latin', () => {
    expect(latinDigits('باب ٣٧ و۲۱۵')).toBe('باب 37 و215');
  });
});
