/**
 * Output-language resolution (no network).
 *
 * Issue #34: the UI locale was deciding the language of generated artifacts,
 * and the `language` argument documented as "Spanish" never matched anything —
 * NotebookLM wants a BCP-47 code. These lock the resolver that separates the
 * two, including the refusal that replaced the silent substitution.
 */
import { describe, it, expect } from '@jest/globals';
import {
  resolveContentLanguage,
  contentLanguageName,
  CONTENT_LANGUAGES,
  DEFAULT_CONTENT_LANGUAGE,
} from '../utils/content-language.js';

describe('resolveContentLanguage', () => {
  it('accepts a code as-is, whatever its case', () => {
    expect(resolveContentLanguage('es')).toBe('es');
    expect(resolveContentLanguage('ES')).toBe('es');
    expect(resolveContentLanguage('ja')).toBe('ja');
  });

  it('accepts both separators for a regional code', () => {
    expect(resolveContentLanguage('pt_BR')).toBe('pt_BR');
    expect(resolveContentLanguage('pt-BR')).toBe('pt_BR');
    expect(resolveContentLanguage('zh-Hans')).toBe('zh_Hans');
  });

  it('accepts the English name the tool description advertises', () => {
    expect(resolveContentLanguage('Spanish')).toBe('es');
    expect(resolveContentLanguage('japanese')).toBe('ja');
  });

  it('accepts the native name NotebookLM displays', () => {
    expect(resolveContentLanguage('Español')).toBe('es');
    expect(resolveContentLanguage('Français')).toBe('fr');
  });

  it('falls back to the base language for an unlisted region', () => {
    expect(resolveContentLanguage('es-CO')).toBe('es');
  });

  it('returns null for something it cannot place, rather than guessing', () => {
    expect(resolveContentLanguage('Klingon')).toBeNull();
    expect(resolveContentLanguage('xx')).toBeNull();
    expect(resolveContentLanguage('')).toBeNull();
    expect(resolveContentLanguage(undefined)).toBeNull();
  });

  it('resolves every catalog entry by its own code', () => {
    for (const code of Object.keys(CONTENT_LANGUAGES)) {
      expect(resolveContentLanguage(code)).toBe(code);
    }
  });

  it('resolves every native name to a code carrying that same name', () => {
    // Hebrew appears twice — `he` and the deprecated `iw` Google still ships —
    // so a native name is not a unique key. Any code bearing the name is a
    // correct answer; requiring a particular one would be asserting map order.
    for (const [code, native] of Object.entries(CONTENT_LANGUAGES)) {
      const resolved = resolveContentLanguage(native);
      expect(resolved).not.toBeNull();
      expect(CONTENT_LANGUAGES[resolved!]).toBe(CONTENT_LANGUAGES[code]);
    }
  });
});

describe('the catalog itself', () => {
  it('covers the 81 languages NotebookLM offers', () => {
    expect(Object.keys(CONTENT_LANGUAGES)).toHaveLength(81);
  });

  it('defaults to a language that is in the catalog', () => {
    expect(CONTENT_LANGUAGES[DEFAULT_CONTENT_LANGUAGE]).toBeDefined();
  });

  it('gives the native name the browser menu lists, not the English one', () => {
    expect(contentLanguageName('es')).toBe('Español');
    expect(contentLanguageName('de')).toBe('Deutsch');
    expect(contentLanguageName('xx')).toBeUndefined();
  });
});
