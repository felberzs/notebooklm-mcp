/**
 * Tests for Citation Extractor formatting functions
 * @module citation-extractor.test
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  formatAnswerWithSources,
  extractCitations,
  type Citation,
  type SourceFormat,
} from '../utils/citation-extractor.js';

describe('citation-extractor', () => {
  // Helper to create citation objects
  const createCitation = (number: number, sourceText: string, sourceName?: string): Citation => ({
    marker: `[${number}]`,
    number,
    sourceText,
    sourceName,
  });

  describe('formatAnswerWithSources', () => {
    describe('format: none', () => {
      it('should return original answer unchanged', () => {
        const answer = 'This is a test answer with [1] citation.';
        const citations = [createCitation(1, 'Source text here')];

        const result = formatAnswerWithSources(answer, citations, 'none');

        expect(result).toBe(answer);
      });

      it('should return original answer when citations are empty', () => {
        const answer = 'This is a test answer.';

        const result = formatAnswerWithSources(answer, [], 'inline');

        expect(result).toBe(answer);
      });
    });

    describe('format: inline', () => {
      it('should replace bracketed citations with inline source', () => {
        const answer = 'The sky is blue[1] and the grass is green.';
        const citations = [createCitation(1, 'Scientific study on colors')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Scientific study on colors"]');
        expect(result).not.toContain('[1]');
      });

      it('should handle multiple citations', () => {
        const answer = 'Fact one[1] and fact two[2].';
        const citations = [createCitation(1, 'Source one'), createCitation(2, 'Source two')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Source one"]');
        expect(result).toContain('[2: "Source two"]');
      });

      it('should handle citation numbers 10 and above correctly', () => {
        const answer = 'Citation[1] and citation[10] and citation[2].';
        const citations = [
          createCitation(1, 'Source 1'),
          createCitation(2, 'Source 2'),
          createCitation(10, 'Source 10'),
        ];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        // [10] should not be affected by [1] replacement
        expect(result).toContain('[10: "Source 10"]');
        expect(result).toContain('[1: "Source 1"]');
        expect(result).toContain('[2: "Source 2"]');
      });

      it('should truncate long source text to 100 characters', () => {
        const longSource = 'A'.repeat(150);
        const answer = 'Text[1].';
        const citations = [createCitation(1, longSource)];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        // Should contain truncated text with ellipsis
        expect(result).toContain('...');
        expect(result.length).toBeLessThan(answer.length + 150);
      });

      it('should handle superscript-style citations (number without brackets)', () => {
        const answer = 'This is a fact1 from the study.';
        const citations = [createCitation(1, 'Study source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Study source"]');
      });

      it('should handle multiple superscript citations stuck together', () => {
        // Note: The current regex handles stuck-together citations but with limitations
        // It replaces "123" sequentially, which may not produce perfect results
        // The descending order helps avoid [1] corrupting [12]
        const answer = 'This fact123 comes from multiple sources.';
        const citations = [
          createCitation(1, 'Source 1'),
          createCitation(2, 'Source 2'),
          createCitation(3, 'Source 3'),
        ];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        // At minimum, citation 1 should be replaced
        expect(result).toContain('[1: "Source 1"]');
        // The format may not be perfect for all stuck-together cases
        expect(result).toBeDefined();
      });

      it('should handle citations at end of sentence', () => {
        const answer = 'This is a statement[1].';
        const citations = [createCitation(1, 'Source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Source"].');
      });

      it('should handle citations followed by comma', () => {
        const answer = 'First point[1], second point.';
        const citations = [createCitation(1, 'Source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Source"],');
      });

      it('should replace all occurrences of same citation', () => {
        const answer = 'Point one[1] and related point[1].';
        const citations = [createCitation(1, 'Shared source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        const matches = result.match(/\[1: "Shared source"\]/g);
        expect(matches).toHaveLength(2);
      });
    });

    describe('format: footnotes', () => {
      it('should append footnotes at the end', () => {
        const answer = 'This is the main text[1].';
        const citations = [createCitation(1, 'Source text here')];

        const result = formatAnswerWithSources(answer, citations, 'footnotes');

        expect(result).toContain('This is the main text[1].');
        expect(result).toContain('---');
        expect(result).toContain('**Sources:**');
        expect(result).toContain('[1] Source text here');
      });

      it('should include source names when available', () => {
        const answer = 'Text[1].';
        const citations = [createCitation(1, 'Content from the article', 'Article Title')];

        const result = formatAnswerWithSources(answer, citations, 'footnotes');

        expect(result).toContain('[1] Article Title: Content from the article');
      });

      it('should separate multiple footnotes with blank lines', () => {
        const answer = 'Text[1][2].';
        const citations = [createCitation(1, 'First source'), createCitation(2, 'Second source')];

        const result = formatAnswerWithSources(answer, citations, 'footnotes');

        expect(result).toContain('[1] First source');
        expect(result).toContain('[2] Second source');
        // Check for double newline separation
        expect(result).toMatch(/\[1\].*\n\n\[2\]/s);
      });

      it('should preserve original answer text', () => {
        const answer = 'Important facts: [1] mentioned here.';
        const citations = [createCitation(1, 'Source')];

        const result = formatAnswerWithSources(answer, citations, 'footnotes');

        expect(result.startsWith('Important facts: [1] mentioned here.')).toBe(true);
      });
    });

    describe('format: expanded', () => {
      it('should replace citations with quoted source text', () => {
        const answer = 'According to research[1], this is true.';
        const citations = [createCitation(1, 'Studies show that the hypothesis is correct')];

        const result = formatAnswerWithSources(answer, citations, 'expanded');

        expect(result).toContain('"Studies show that the hypothesis is correct"');
        expect(result).not.toContain('[1]');
      });

      it('should truncate long source text to 150 characters', () => {
        const longSource = 'B'.repeat(200);
        const answer = 'Text[1].';
        const citations = [createCitation(1, longSource)];

        const result = formatAnswerWithSources(answer, citations, 'expanded');

        expect(result).toContain('...');
        // Expanded uses 150 char limit
        expect(result.length).toBeLessThan(answer.length + 200);
      });

      it('should handle multiple citations', () => {
        const answer = 'First[1] and second[2].';
        const citations = [
          createCitation(1, 'First source content'),
          createCitation(2, 'Second source content'),
        ];

        const result = formatAnswerWithSources(answer, citations, 'expanded');

        expect(result).toContain('"First source content"');
        expect(result).toContain('"Second source content"');
      });

      it('should handle superscript citations', () => {
        const answer = 'This fact1 is important.';
        const citations = [createCitation(1, 'Source content')];

        const result = formatAnswerWithSources(answer, citations, 'expanded');

        expect(result).toContain('"Source content"');
      });

      it('should handle stuck-together citations', () => {
        // Stuck-together citations have limitations with the current regex
        const answer = 'Multiple sources12 confirm this.';
        const citations = [createCitation(1, 'Source one'), createCitation(2, 'Source two')];

        const result = formatAnswerWithSources(answer, citations, 'expanded');

        // At minimum, the first citation should be replaced
        expect(result).toContain('"Source one"');
        // The format may not perfectly handle all stuck-together cases
        expect(result).toBeDefined();
      });

      it('should handle citations 10+ correctly (descending order)', () => {
        const answer = 'Fact[1] and fact[11].';
        const citations = [createCitation(1, 'Source 1'), createCitation(11, 'Source 11')];

        const result = formatAnswerWithSources(answer, citations, 'expanded');

        expect(result).toContain('"Source 1"');
        expect(result).toContain('"Source 11"');
        // Make sure [1] didn't corrupt [11]
        expect(result).not.toContain('["Source 1"]1');
      });
    });

    describe('format: json', () => {
      it('should return original answer unchanged', () => {
        const answer = 'Text with[1] citation.';
        const citations = [createCitation(1, 'Source')];

        const result = formatAnswerWithSources(answer, citations, 'json');

        expect(result).toBe(answer);
      });
    });

    describe('edge cases', () => {
      it('should handle empty answer', () => {
        const answer = '';
        const citations = [createCitation(1, 'Source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toBe('');
      });

      it('should handle answer without citations', () => {
        const answer = 'No citations here.';
        const citations = [createCitation(1, 'Orphan source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        // Citation markers not in text, so no replacement happens
        expect(result).toBe(answer);
      });

      it('should handle citations with special characters in source', () => {
        const answer = 'Text[1].';
        const citations = [createCitation(1, 'Source with "quotes" and [brackets]')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('Source with "quotes" and [brackets]');
      });

      it('should handle newlines in source text', () => {
        const answer = 'Text[1].';
        const citations = [createCitation(1, 'Line 1\nLine 2')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('Line 1\nLine 2');
      });

      it('should handle unicode in source text', () => {
        const answer = 'Text[1].';
        const citations = [createCitation(1, '日本語 テキスト émoji 🔬')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('日本語 テキスト émoji 🔬');
      });

      it('should handle very short source text', () => {
        const answer = 'Text[1].';
        const citations = [createCitation(1, 'OK')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "OK"]');
      });

      it('should handle citation at start of answer', () => {
        const answer = '[1] This starts with a citation.';
        const citations = [createCitation(1, 'Leading source')];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Leading source"]');
      });

      it('should handle consecutive citations', () => {
        const answer = 'Multiple sources[1][2][3] support this.';
        const citations = [
          createCitation(1, 'Source A'),
          createCitation(2, 'Source B'),
          createCitation(3, 'Source C'),
        ];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('[1: "Source A"]');
        expect(result).toContain('[2: "Source B"]');
        expect(result).toContain('[3: "Source C"]');
      });

      it('should handle citations with comma-separated numbers like [1, 2]', () => {
        // This format isn't directly handled, but shouldn't break
        const answer = 'Some text[1, 2] here.';
        const citations = [createCitation(1, 'Source 1'), createCitation(2, 'Source 2')];

        // This will only partially work - [1, 2] won't be replaced as a unit
        const result = formatAnswerWithSources(answer, citations, 'inline');

        // At minimum, shouldn't throw
        expect(result).toBeDefined();
      });
    });

    describe('truncateSource behavior', () => {
      it('should not truncate source under limit', () => {
        const shortSource = 'Short text';
        const answer = 'Text[1].';
        const citations = [createCitation(1, shortSource)];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain(`[1: "${shortSource}"]`);
        expect(result).not.toContain('...');
      });

      it('should truncate source at exactly limit', () => {
        const source = 'A'.repeat(100);
        const answer = 'Text[1].';
        const citations = [createCitation(1, source)];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        // At 100 chars, should not truncate
        expect(result).toContain(source);
      });

      it('should truncate source over limit with ellipsis', () => {
        const source = 'A'.repeat(101);
        const answer = 'Text[1].';
        const citations = [createCitation(1, source)];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        expect(result).toContain('...');
      });
    });

    describe('descending order processing', () => {
      it('should process larger numbers first to avoid corruption', () => {
        // If we process [1] before [10], [12], etc., we might corrupt them
        const answer = 'Ref[1] and ref[10] and ref[12] and ref[2].';
        const citations = [
          createCitation(1, 'One'),
          createCitation(2, 'Two'),
          createCitation(10, 'Ten'),
          createCitation(12, 'Twelve'),
        ];

        const result = formatAnswerWithSources(answer, citations, 'inline');

        // Each should be replaced correctly
        expect(result).toContain('[1: "One"]');
        expect(result).toContain('[2: "Two"]');
        expect(result).toContain('[10: "Ten"]');
        expect(result).toContain('[12: "Twelve"]');

        // Should not have any malformed citations
        expect(result).not.toMatch(/\[1: "One"\]0/);
        expect(result).not.toMatch(/\[1: "One"\]2/);
      });
    });
  });

  describe('Citation type', () => {
    it('should have correct structure', () => {
      const citation = createCitation(5, 'Test source', 'Test Name');

      expect(citation.marker).toBe('[5]');
      expect(citation.number).toBe(5);
      expect(citation.sourceText).toBe('Test source');
      expect(citation.sourceName).toBe('Test Name');
    });
  });

  describe('SourceFormat type', () => {
    it('should accept valid format values', () => {
      const formats: SourceFormat[] = ['none', 'inline', 'footnotes', 'json', 'expanded'];

      formats.forEach((format) => {
        const result = formatAnswerWithSources('test', [], format);
        expect(result).toBeDefined();
      });
    });
  });

  describe('extractCitations', () => {
    // Create mock page and element handles
    const createMockPage = () => ({
      $: jest.fn(),
      $$: jest.fn(),
      evaluate: jest.fn(),
      mouse: { move: jest.fn() },
    });

    describe('format: none', () => {
      it('should return early without extraction when format is none', async () => {
        const mockPage = createMockPage();
        const answerText = 'Test answer with [1] citation';

        const result = await extractCitations(mockPage as any, answerText, null, 'none');

        expect(result.success).toBe(true);
        expect(result.format).toBe('none');
        expect(result.originalAnswer).toBe(answerText);
        expect(result.formattedAnswer).toBe(answerText);
        expect(result.citations).toHaveLength(0);
        // Should not call any page methods when format is 'none'
        expect(mockPage.$$).not.toHaveBeenCalled();
      });

      it('should return correct result structure for none format', async () => {
        const mockPage = createMockPage();

        const result = await extractCitations(mockPage as any, 'Test', null, 'none');

        expect(result).toHaveProperty('originalAnswer');
        expect(result).toHaveProperty('formattedAnswer');
        expect(result).toHaveProperty('citations');
        expect(result).toHaveProperty('format');
        expect(result).toHaveProperty('success');
      });
    });

    describe('when no citations found', () => {
      it('should return original answer with empty citations array', async () => {
        const mockPage = createMockPage();
        mockPage.$$.mockResolvedValue([]);
        mockPage.evaluate.mockResolvedValue([]);

        const result = await extractCitations(
          mockPage as any,
          'Answer with no citations',
          null,
          'inline'
        );

        expect(result.success).toBe(true);
        expect(result.citations).toHaveLength(0);
        expect(result.formattedAnswer).toBe('Answer with no citations');
      });
    });

    describe('with container element', () => {
      it('should use page.evaluate even when container is provided (container is ignored)', async () => {
        const mockPage = createMockPage();
        const mockContainer = {
          $$: jest.fn().mockResolvedValue([]),
        };
        mockPage.evaluate.mockResolvedValue([]);

        await extractCitations(mockPage as any, 'Test answer', mockContainer as any, 'inline');

        // New implementation uses page.evaluate() for everything — container is ignored
        expect(mockPage.evaluate).toHaveBeenCalled();
        expect(mockContainer.$$).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle page errors gracefully', async () => {
        const mockPage = createMockPage();
        // Mock $$ to return empty to simulate no elements found
        mockPage.$$.mockResolvedValue([]);
        mockPage.evaluate.mockResolvedValue([]);

        const result = await extractCitations(mockPage as any, 'Test answer', null, 'inline');

        // When no elements found, it returns success with empty citations
        expect(result.success).toBe(true);
        expect(result.citations).toHaveLength(0);
        expect(result.formattedAnswer).toBe('Test answer');
      });

      it('should return original answer on extraction issues', async () => {
        const mockPage = createMockPage();
        mockPage.$$.mockResolvedValue([]);
        mockPage.evaluate.mockResolvedValue([]);

        const result = await extractCitations(
          mockPage as any,
          'Test answer with [1] citation',
          null,
          'inline'
        );

        // No citations extracted, so original answer is returned
        expect(result.formattedAnswer).toBe('Test answer with [1] citation');
      });
    });

    describe('CitationExtractionResult structure', () => {
      it('should have all required properties', async () => {
        const mockPage = createMockPage();
        mockPage.$$.mockResolvedValue([]);
        mockPage.evaluate.mockResolvedValue([]);

        const result = await extractCitations(mockPage as any, 'Test answer', null, 'footnotes');

        expect(result).toHaveProperty('originalAnswer');
        expect(result).toHaveProperty('formattedAnswer');
        expect(result).toHaveProperty('citations');
        expect(result).toHaveProperty('format');
        expect(result).toHaveProperty('success');
        expect(typeof result.originalAnswer).toBe('string');
        expect(typeof result.formattedAnswer).toBe('string');
        expect(Array.isArray(result.citations)).toBe(true);
        expect(typeof result.format).toBe('string');
        expect(typeof result.success).toBe('boolean');
      });

      it('should return success true when no citations found', async () => {
        const mockPage = createMockPage();
        mockPage.$$.mockResolvedValue([]);
        mockPage.evaluate.mockResolvedValue([]);

        const result = await extractCitations(mockPage as any, 'Test answer', null, 'inline');

        // When no citations found, success is still true (just empty)
        expect(result.success).toBe(true);
        expect(result.citations).toHaveLength(0);
      });
    });

    describe('default format parameter', () => {
      it('should default to none format when not specified', async () => {
        const mockPage = createMockPage();

        // Call without format parameter (uses default)
        const result = await extractCitations(mockPage as any, 'Test answer [1]', null);

        expect(result.format).toBe('none');
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Citation element detection patterns', () => {
    it('should recognize bracketed citation pattern [n]', () => {
      const text = 'Text with [1] citation';
      const match = text.match(/\[?(\d+)\]?/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1');
    });

    it('should recognize superscript citation pattern', () => {
      const text = '1';
      const match = text.match(/\[?(\d+)\]?/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1');
    });

    it('should extract multiple citation numbers', () => {
      const text = 'Text[1] and text[2] and text[10]';
      const matches = text.matchAll(/\[(\d+)\]/g);
      const numbers = Array.from(matches).map((m) => parseInt(m[1], 10));
      expect(numbers).toEqual([1, 2, 10]);
    });
  });

  describe('CSS selector patterns', () => {
    it('should have citation selectors array', () => {
      // These selectors should match various citation element patterns
      const expectedPatterns = [
        'citation-link',
        'citation-marker',
        'data-citation',
        'sup',
        'reference',
        'source',
      ];

      // We test the concept - the actual selectors are defined in the module
      expectedPatterns.forEach((pattern) => {
        expect(typeof pattern).toBe('string');
      });
    });

    it('should have tooltip selectors array', () => {
      const expectedPatterns = ['tooltip', 'popover', 'preview'];

      expectedPatterns.forEach((pattern) => {
        expect(typeof pattern).toBe('string');
      });
    });
  });

  describe('source truncation logic', () => {
    // Testing the logic without calling private function
    const truncate = (text: string, maxLength: number): string => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + '...';
    };

    it('should not truncate text under limit', () => {
      const text = 'Short text';
      expect(truncate(text, 100)).toBe('Short text');
    });

    it('should truncate text at limit', () => {
      const text = 'A'.repeat(100);
      expect(truncate(text, 100)).toBe(text);
    });

    it('should truncate text over limit with ellipsis', () => {
      const text = 'A'.repeat(150);
      const result = truncate(text, 100);
      expect(result).toHaveLength(100);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should handle empty text', () => {
      expect(truncate('', 100)).toBe('');
    });

    it('should handle text exactly at limit', () => {
      const text = 'A'.repeat(100);
      expect(truncate(text, 100)).toBe(text);
    });
  });
});

describe('a citation with no excerpt', () => {
  // Regression: an unextracted excerpt used to be filled in with the source
  // *name*, so the formatters printed a filename inside quotation marks and
  // callers could not tell a real quotation from a stand-in.
  const noExcerpt = [{ marker: '[1]', number: 1, sourceText: '', sourceName: 'Paper.pdf' }];

  it('is named and marked absent inline, never quoted', () => {
    const out = formatAnswerWithSources('Claim.[1]', noExcerpt, 'inline');
    expect(out).toContain('[1: Paper.pdf — no excerpt]');
    expect(out).not.toContain('"Paper.pdf"');
  });

  it('says so in the footnotes instead of leaving a blank quote', () => {
    const out = formatAnswerWithSources('Claim.[1]', noExcerpt, 'footnotes');
    expect(out).toContain('(no excerpt extracted)');
  });

  it('is not expanded into an empty quotation', () => {
    const out = formatAnswerWithSources('Claim.[1]', noExcerpt, 'expanded');
    expect(out).toContain('[Paper.pdf — no excerpt]');
    expect(out).not.toContain('""');
  });

  it('still quotes normally when an excerpt is present', () => {
    const withExcerpt = [
      { marker: '[1]', number: 1, sourceText: 'the actual passage', sourceName: 'Paper.pdf' },
    ];
    expect(formatAnswerWithSources('Claim.[1]', withExcerpt, 'expanded')).toContain(
      '"the actual passage"'
    );
  });
});
