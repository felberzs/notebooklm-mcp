/**
 * Page utilities for extracting responses from NotebookLM web UI
 *
 * This module provides functions to:
 * - Extract latest assistant responses from the page
 * - Wait for new responses with streaming detection
 * - Detect placeholders and loading states
 * - Snapshot existing responses for comparison
 *
 * Based on the Python implementation from page_utils.py
 */

import type { Page } from 'patchright';
import { log } from './logger.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * CSS selectors to find assistant response elements
 * Ordered by priority (most specific first)
 */
const RESPONSE_SELECTORS = [
  '.to-user-container .message-text-content',
  "[data-message-author='bot']",
  "[data-message-author='assistant']",
  "[data-message-role='assistant']",
  "[data-author='assistant']",
  "[data-renderer*='assistant']",
  "[data-automation-id='response-text']",
  "[data-automation-id='assistant-response']",
  "[data-automation-id='chat-response']",
  "[data-testid*='assistant']",
  "[data-testid*='response']",
  "[aria-live='polite']",
  "[role='listitem'][data-message-author]",
];

/**
 * Text snippets that indicate a placeholder/loading state
 */
const PLACEHOLDER_SNIPPETS = [
  'antwort wird erstellt',
  'answer wird erstellt',
  'answer is being created',
  'answer is being generated',
  'creating answer',
  'generating answer',
  'wird erstellt',
  'getting the context', // NotebookLM initial loading message
  'getting the gist', // NotebookLM loading message (English)
  'analyse en cours', // NotebookLM loading message (French)
  'loading',
  'please wait',
  // NotebookLM English loading messages (seen in logs)
  'looking for clues',
  'reading full chapters',
  'examining the specifics',
  'checking the scope',
  'opening your notes',
  'analyzing your files',
  'searching your docs',
  'scanning sources',
  'reviewing content',
  'processing request',
];

// Error messages from NotebookLM that indicate failure
// These trigger immediate return (no stability wait) but NOT account rotation.
const ERROR_SNIPPETS = [
  "le système n'a pas pu répondre", // French: The system could not respond
  'the system could not respond',
  "le système n'a pas réussi",
  'the system failed',
  'an error occurred',
  'une erreur est survenue',
  'try again later',
  'réessayez plus tard',
];

// Rate limit specific messages (trigger account rotation)
// IMPORTANT: Must be VERY specific — generic phrases like "daily limit" or "revenez plus tard"
// can appear in academic answers and cause false positives.
const RATE_LIMIT_MESSAGES = [
  'vous avez atteint la limite quotidienne', // French: You have reached the daily limit
  'limite quotidienne de discussions', // French: Daily discussion limit
  'daily discussion limit',
  'daily limit reached',
  'query limit reached',
  'rate limit exceeded',
];

/**
 * Standalone UI control labels that can leak into extracted response text.
 * Only strip them when they appear as isolated lines to avoid mutating
 * legitimate answer content.
 */
const UI_CONTROL_LINES = new Set([
  'more_horiz',
  'more_vert',
  'open_in_new',
  'content_copy',
  'bookmark_border',
  'expand_more',
  'expand_less',
]);

/**
 * Check if text is an error message from NotebookLM
 */
export function isErrorMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return ERROR_SNIPPETS.some((snippet) => lower.includes(snippet));
}

/**
 * Check if text indicates a rate limit error (should trigger account rotation)
 */
export function isRateLimitMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return RATE_LIMIT_MESSAGES.some((msg) => lower.includes(msg));
}

/**
 * Remove leaked UI-control text from NotebookLM responses.
 */
export function sanitizeResponseText(text: string): string {
  const trimmed = text.replace(/\r/g, '').trim();
  if (!trimmed) return '';

  const rawLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cleanedLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const prev = rawLines[i - 1] ?? '';
    const next = rawLines[i + 1] ?? '';
    const lower = line.toLowerCase();
    const prevIsUi = UI_CONTROL_LINES.has(prev.toLowerCase());
    const nextIsUi = UI_CONTROL_LINES.has(next.toLowerCase());

    if (UI_CONTROL_LINES.has(lower)) {
      continue;
    }

    if (/^\d+$/.test(line) && nextIsUi) {
      continue;
    }

    if (/^[.,;:!?]+$/.test(line) && (prevIsUi || nextIsUi)) {
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines
    .join('\n')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Simple string hash function (for efficient comparison)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Check if text is a placeholder/loading message
 * Also treats short texts ending with "..." as placeholders (loading indicators)
 */
function isPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();

  // Known placeholder phrases
  if (PLACEHOLDER_SNIPPETS.some((snippet) => lower.includes(snippet))) {
    return true;
  }

  // Short text ending with "..." is likely a loading message
  // Real responses are typically > 50 chars
  if (text.length < 50 && text.trim().endsWith('...')) {
    return true;
  }

  return false;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Snapshot the latest response text currently visible
 * Returns null if no response found
 */
export async function snapshotLatestResponse(page: Page): Promise<string | null> {
  return await extractLatestText(page, new Map(), false, 0);
}

/**
 * Snapshot ALL existing assistant response texts
 * Used to capture visible responses BEFORE submitting a new question
 */
export async function snapshotAllResponses(page: Page): Promise<string[]> {
  const allTexts: string[] = [];
  const primarySelector = '.to-user-container';

  try {
    const containers = await page.$$(primarySelector);
    if (containers.length > 0) {
      for (const container of containers) {
        try {
          const textElement = await container.$('.message-text-content');
          if (textElement) {
            const text = await textElement.innerText();
            if (text && text.trim()) {
              const sanitized = sanitizeResponseText(text);
              if (sanitized) {
                allTexts.push(sanitized);
              }
            }
          }
        } catch {
          continue;
        }
      }

      log.info(`📸 [SNAPSHOT] Captured ${allTexts.length} existing responses`);
    }
  } catch (error) {
    log.warning(`⚠️ [SNAPSHOT] Failed to snapshot responses: ${error}`);
  }

  return allTexts;
}

/**
 * Snapshot the answer texts currently rendered in the chat, as a multiset
 * (text hash -> how many times that exact text appears).
 *
 * This is the "before" state for `waitForLatestAnswer`. Counting occurrences
 * rather than collecting a plain set is what makes a *repeated* answer text
 * detectable: if the notebook already shows one "Yes" and the new answer is
 * also "Yes", the count goes 1 -> 2, which a set could never reveal.
 *
 * Identity is deliberately content-only. DOM position is NOT usable here:
 * NotebookLM's chat list is virtualized and the mounted window does not keep
 * DOM order in sync with message recency — a freshly generated answer has been
 * observed at index 8 of 11 with older, already-known answers at 9 and 10.
 * See issue #30's sibling report in PR #29.
 */
export async function snapshotAnswerTexts(page: Page): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  try {
    const containers = await page.$$('.to-user-container');
    for (const container of containers) {
      try {
        const textElement = await container.$('.message-text-content');
        if (!textElement) continue;
        const sanitized = sanitizeResponseText((await textElement.innerText()) || '');
        if (!sanitized) continue;
        const h = hashString(sanitized);
        counts.set(h, (counts.get(h) ?? 0) + 1);
      } catch {
        continue;
      }
    }
  } catch {
    // A failed snapshot yields an empty baseline: every mounted text then reads
    // as new, which is the same behaviour as having no baseline at all.
  }
  return counts;
}

/**
 * Count the number of visible assistant response elements
 */
export async function countResponseElements(page: Page): Promise<number> {
  let count = 0;
  for (const selector of RESPONSE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      if (elements.length > 0) {
        // Count only visible elements
        for (const el of elements) {
          try {
            const isVisible = await el.isVisible();
            if (isVisible) {
              count++;
            }
          } catch {
            continue;
          }
        }
        // If we found elements with this selector, stop trying others
        if (count > 0) {
          break;
        }
      }
    } catch {
      continue;
    }
  }
  return count;
}

/**
 * Wait for a new assistant response with streaming detection
 *
 * This function:
 * 1. Polls the page for new response text
 * 2. Detects streaming (text changes) vs. complete (text stable)
 * 3. Requires text to be stable for 3 consecutive polls before returning
 * 4. Ignores placeholders, question echoes, and known responses
 *
 * @param page Playwright page instance
 * @param options Options for waiting
 * @returns The new response text, or null if timeout
 */
export async function waitForLatestAnswer(
  page: Page,
  options: {
    question?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    ignoreTexts?: string[];
    /**
     * Multiset of answer texts present BEFORE the question was submitted, from
     * `snapshotAnswerTexts`. A text counts as "new" when it appears more often
     * now than it did then, which detects a repeated answer text that plain
     * hash dedup would skip as already-seen.
     *
     * Position-based identity was tried (3.0.x) and disproven: the chat list is
     * virtualized, so DOM order does not track recency.
     */
    baselineCounts?: Map<number, number>;
    debug?: boolean;
  } = {}
): Promise<string | null> {
  const {
    question = '',
    timeoutMs = 120000,
    pollIntervalMs = 1000,
    ignoreTexts = [],
    baselineCounts,
    debug = false,
  } = options;

  const deadline = Date.now() + timeoutMs;
  const sanitizedQuestion = question.trim().toLowerCase();

  // Baseline multiset: text hash -> occurrences before the question was sent.
  // Occurrences (not a plain set) are what make a repeated answer text visible.
  const baseline = new Map<number, number>(baselineCounts ?? []);
  for (const text of ignoreTexts) {
    if (typeof text === 'string' && text.trim()) {
      const h = hashString(text.trim());
      baseline.set(h, (baseline.get(h) ?? 0) + 1);
    }
  }

  if (debug) {
    log.debug(`🔍 [DEBUG] Waiting for NEW answer. Baseline holds ${baseline.size} distinct texts`);
  }

  let pollCount = 0;
  let lastCandidate: string | null = null;
  let stableCount = 0; // Track how many times we see the same text
  const requiredStablePolls = 3; // Text must be stable for 3 consecutive polls (~3 seconds)

  while (Date.now() < deadline) {
    pollCount++;

    // CHECK INPUT FIELD for rate limit message (appears there after submit)
    try {
      const inputField = await page.$('textarea.query-box-input');
      if (inputField) {
        // Check placeholder
        const placeholder = await inputField.getAttribute('placeholder');
        if (placeholder && isRateLimitMessage(placeholder)) {
          log.error(`🚫 [INPUT] Rate limit in placeholder: "${placeholder.substring(0, 60)}..."`);
          return placeholder; // Return immediately to trigger rotation
        }
        // Check value
        const value = await inputField.inputValue();
        if (value && isRateLimitMessage(value)) {
          log.error(`🚫 [INPUT] Rate limit in input value: "${value.substring(0, 60)}..."`);
          return value; // Return immediately to trigger rotation
        }
      }
    } catch {
      // Input check failed, continue with normal extraction
    }

    // Extract latest NEW text
    const candidate = await extractLatestText(page, baseline, debug, pollCount);

    if (candidate) {
      const normalized = candidate.trim();
      if (normalized) {
        const lower = normalized.toLowerCase();

        // Check if it's a placeholder
        if (isPlaceholder(lower)) {
          if (debug) {
            log.debug(
              `🔍 [DEBUG] Found placeholder: "${normalized.substring(0, 50)}..." - continuing...`
            );
          }
          await page.waitForTimeout(250);
          continue;
        }

        // IMMEDIATE RETURN: Error messages don't need stability check
        if (isErrorMessage(normalized)) {
          log.warning(
            `⚠️ [RESPONSE] NotebookLM error detected: "${normalized.substring(0, 60)}..."`
          );
          return normalized; // Return immediately, no need to wait for stability
        }

        // IMMEDIATE RETURN: Rate limit messages trigger immediate return
        if (isRateLimitMessage(normalized)) {
          log.error(`🚫 [RESPONSE] Rate limit detected: "${normalized.substring(0, 60)}..."`);
          return normalized; // Return immediately to trigger account rotation
        }

        // DEBUG: Log the candidate text to see what we're getting
        if (debug && normalized !== lastCandidate) {
          log.debug(
            `🔍 [DEBUG] New candidate text (${normalized.length} chars): "${normalized.substring(0, 100)}..."`
          );
        }

        // Check if it's the question echo
        if (lower === sanitizedQuestion) {
          if (debug) {
            log.debug('🔍 [DEBUG] Found question echo, ignoring');
          }
          // Absorb the echo into the baseline so it stops reading as excess.
          const echoHash = hashString(normalized);
          baseline.set(echoHash, (baseline.get(echoHash) ?? 0) + 1);
          await page.waitForTimeout(pollIntervalMs);
          continue;
        }

        // ========================================
        // STREAMING DETECTION: Check if text is stable
        // ========================================
        if (normalized === lastCandidate) {
          // Text hasn't changed - it's stable
          stableCount++;
          if (debug && stableCount === requiredStablePolls) {
            log.debug(
              `✅ [DEBUG] Text stable for ${stableCount} polls (${normalized.length} chars)`
            );
          }
        } else {
          // Text changed - streaming in progress
          if (debug && lastCandidate) {
            log.debug(
              `🔄 [DEBUG] Text changed (${normalized.length} chars, was ${lastCandidate.length})`
            );
          }
          stableCount = 1;
          lastCandidate = normalized;
        }

        // Only return once text is stable
        if (stableCount >= requiredStablePolls) {
          if (debug) {
            log.debug(`✅ [DEBUG] Returning stable answer (${normalized.length} chars)`);
          }
          return normalized;
        }
      }
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  if (debug) {
    log.debug(`⏱️ [DEBUG] Timeout after ${pollCount} polls`);
  }
  return null;
}

/**
 * Extract the latest NEW response text from the page.
 *
 * Identity is by content *multiplicity*, never by DOM position. A mounted
 * answer counts as new when its exact text now appears more often than the
 * pre-submission baseline recorded — so a second "Yes" is detected (its count
 * goes 1 -> 2) while an unchanged older answer is not.
 *
 * Position was used until 3.0.2 and is wrong here: the chat list is
 * virtualized, so the mounted window does not preserve message recency.
 *
 * Known residual limit: if an older message was NOT mounted when the baseline
 * was taken (virtualization again), it is absent from the baseline and reads as
 * new the moment it scrolls into view. `question` is carried in the options for
 * a future anchor-based identity that would close this; it needs DOM structure
 * we cannot verify without a live session.
 *
 * @param page Playwright page instance
 * @param baseline Text hash -> occurrences before the question was submitted
 * @param debug Enable debug logging
 * @param pollCount Current poll number (for conditional logging)
 * @returns The new response text, or null
 */
async function extractLatestText(
  page: Page,
  baseline: Map<number, number>,
  debug: boolean,
  pollCount: number
): Promise<string | null> {
  // Scroll to bottom periodically to reveal new messages (every 5 polls)
  if (pollCount % 5 === 0) {
    try {
      await page.evaluate(`
        (() => {
          const containers = document.querySelectorAll('.chat-scroll-container, .messages-container, [class*="scroll"]');
          containers.forEach(c => { c.scrollTop = c.scrollHeight; });
          window.scrollTo(0, document.body.scrollHeight);
        })()
      `);
    } catch {
      // Ignore scroll errors
    }
  }

  // Try the primary selector first (most specific for NotebookLM)
  const primarySelector = '.to-user-container';
  try {
    const containers = await page.$$(primarySelector);
    const totalContainers = containers.length;

    // Log container count (but don't early exit - always check content)
    if (debug && pollCount % 5 === 0) {
      log.dim(`⏭️ [EXTRACT] Checking ${totalContainers} containers (baseline ${baseline.size})`);
    }

    if (containers.length > 0) {
      if (debug && pollCount % 5 === 0) {
        log.dim(`🔍 [EXTRACT] Scanning ${totalContainers} containers (baseline ${baseline.size})`);
      }

      // Read every mounted container, in DOM order, and tally how often each
      // exact text occurs right now.
      const texts: string[] = [];
      let empty = 0;
      for (const container of containers) {
        try {
          const textElement = await container.$('.message-text-content');
          if (!textElement) continue;
          const sanitized = sanitizeResponseText((await textElement.innerText()) || '');
          if (sanitized) texts.push(sanitized);
          else empty++;
        } catch {
          continue;
        }
      }

      // A text is new when it occurs more often than the baseline recorded.
      // Walking the tally as we go handles duplicates within this poll too.
      const seenSoFar = new Map<number, number>();
      const candidates: string[] = [];
      for (const text of texts) {
        const h = hashString(text);
        const soFar = (seenSoFar.get(h) ?? 0) + 1;
        seenSoFar.set(h, soFar);
        if (soFar > (baseline.get(h) ?? 0)) candidates.push(text);
      }

      if (candidates.length > 0) {
        if (candidates.length > 1) {
          // Normally impossible: one question yields one answer. More than one
          // means the baseline was incomplete (a message was unmounted when it
          // was taken). Take the last in DOM order and say so, so it is
          // diagnosable rather than silent.
          log.warning(
            `⚠️ [EXTRACT] ${candidates.length} texts exceed the baseline — incomplete baseline? Taking the last.`
          );
        }
        const chosen = candidates[candidates.length - 1];
        log.success(`✅ [EXTRACT] Found NEW text: ${chosen.length} chars`);
        return chosen;
      }

      if (debug && pollCount % 5 === 0) {
        log.dim(`⏭️ [EXTRACT] No NEW text (${texts.length} known, ${empty} empty)`);
      }
      return null; // Don't fall through to fallback!
    } else {
      if (debug) {
        log.warning('⚠️ [EXTRACT] No containers found');
      }
    }
  } catch (error) {
    log.error(`❌ [EXTRACT] Primary selector failed: ${error}`);
  }

  // Fallback: Try other selectors (only if primary selector failed/found nothing)
  if (debug) {
    log.dim('🔄 [EXTRACT] Trying fallback selectors...');
  }

  for (const selector of RESPONSE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      if (elements.length === 0) continue;

      // Scan ALL elements to find the first with NEW text
      for (const element of elements) {
        try {
          // Prefer full container text when available
          let container = element;
          try {
            const closest = await element.evaluateHandle((el) => {
              return el.closest(
                '[data-message-author], [data-message-role], [data-author], ' +
                  "[data-testid*='assistant'], [data-automation-id*='response'], article, section"
              );
            });
            if (closest) {
              container = closest.asElement() || element;
            }
          } catch {
            container = element;
          }

          const text = await container.innerText();
          const sanitized = sanitizeResponseText(text || '');
          // Fallback selectors carry no reliable ordering, so presence-vs-baseline
          // is the best available test here.
          if (sanitized && (baseline.get(hashString(sanitized)) ?? 0) === 0) {
            return sanitized;
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  // Final fallback: JavaScript evaluation
  try {
    const fallbackText = await page.evaluate((): string | null => {
      // @ts-expect-error - DOM types available in browser context
      const unique = new Set<Element>();
      // @ts-expect-error - DOM types available in browser context
      const isVisible = (el: Element): boolean => {
        // @ts-expect-error - DOM types available in browser context
        if (!el || !(el as HTMLElement).isConnected) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        // @ts-expect-error - window available in browser context
        const style = window.getComputedStyle(el as HTMLElement);
        if (
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          parseFloat(style.opacity || '1') === 0
        ) {
          return false;
        }
        return true;
      };

      const selectors = [
        '[data-message-author]',
        '[data-message-role]',
        '[data-author]',
        "[data-renderer*='assistant']",
        "[data-testid*='assistant']",
        "[data-automation-id*='response']",
      ];

      const candidates: string[] = [];
      for (const selector of selectors) {
        // @ts-expect-error - document available in browser context
        for (const el of document.querySelectorAll(selector)) {
          if (!isVisible(el)) continue;
          if (unique.has(el)) continue;
          unique.add(el);

          // @ts-expect-error - DOM types available in browser context
          const text = (el as HTMLElement).innerText || (el as HTMLElement).textContent || '';
          if (!text.trim()) continue;

          candidates.push(text.trim());
        }
      }

      if (candidates.length > 0) {
        return candidates[candidates.length - 1];
      }

      return null;
    });

    if (typeof fallbackText === 'string') {
      const sanitized = sanitizeResponseText(fallbackText);
      if (sanitized) {
        return sanitized;
      }
    }
  } catch {
    // Ignore evaluation errors
  }

  return null;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  snapshotLatestResponse,
  snapshotAllResponses,
  snapshotAnswerTexts,
  countResponseElements,
  sanitizeResponseText,
  waitForLatestAnswer,
};
