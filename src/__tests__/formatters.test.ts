/**
 * @jest-environment jsdom
 */
// Unit tests for DOM-dependent formatter utilities (formatters.ts)
// Tests escapeHtml, showToast, announceToScreenReader, and re-exports

import { escapeHtml, showToast, announceToScreenReader, getBadgeClass, formatStatus, getFilesChanged } from '../client/utils/formatters.js';

describe('escapeHtml', () => {
  test('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  test('escapes less-than sign', () => {
    expect(escapeHtml('<')).toBe('&lt;');
  });

  test('escapes greater-than sign', () => {
    expect(escapeHtml('>')).toBe('&gt;');
  });

  test('escapes ampersand', () => {
    expect(escapeHtml('&')).toBe('&amp;');
  });

  test('handles double quotes (not HTML-escaped by textContent)', () => {
    // textContent doesn't escape quotes, just angle brackets and ampersands
    expect(escapeHtml('"')).toBe('"');
  });

  test('escapes HTML tags', () => {
    // textContent escapes < > and & but not quotes
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  test('escapes HTML entities in attributes', () => {
    const html = '<img src="x" onclick="alert(1)">';
    const escaped = escapeHtml(html);
    expect(escaped).toContain('&lt;');
    expect(escaped).toContain('&gt;');
  });

  test('handles mixed content with numbers', () => {
    expect(escapeHtml('123 < 456')).toBe('123 &lt; 456');
  });

  test('converts non-string to string first', () => {
    expect(escapeHtml(123 as any)).toBe('123');
  });
});

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast"></div>';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('sets toast message and visible class', () => {
    const toast = document.getElementById('toast')!;
    showToast('Success message', 'success');

    expect(toast.textContent).toBe('Success message');
    expect(toast.className).toContain('visible');
    expect(toast.className).toContain('toast-success');
  });

  test('removes visible class after timeout', () => {
    const toast = document.getElementById('toast')!;
    showToast('Test message', 'info');

    expect(toast.className).toContain('visible');

    jest.advanceTimersByTime(3500);

    expect(toast.className).not.toContain('visible');
  });

  test('defaults to info type if not specified', () => {
    const toast = document.getElementById('toast')!;
    showToast('Info message');

    expect(toast.className).toContain('toast-info');
  });

  test('handles error type', () => {
    const toast = document.getElementById('toast')!;
    showToast('Error occurred', 'error');

    expect(toast.className).toContain('toast-error');
  });

  test('handles missing toast element gracefully', () => {
    document.body.innerHTML = '';
    expect(() => showToast('Test')).not.toThrow();
  });

  test('clears previous message when showing new toast', () => {
    const toast = document.getElementById('toast')!;
    showToast('First message', 'success');
    expect(toast.textContent).toBe('First message');

    showToast('Second message', 'error');
    expect(toast.textContent).toBe('Second message');
    expect(toast.className).toContain('toast-error');
  });
});

describe('announceToScreenReader', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ariaLive"></div>';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('sets aria-live element textContent', () => {
    const ariaLive = document.getElementById('ariaLive')!;
    announceToScreenReader('Feature created successfully');

    expect(ariaLive.textContent).toBe('Feature created successfully');
  });

  test('clears aria-live element after timeout', () => {
    const ariaLive = document.getElementById('ariaLive')!;
    announceToScreenReader('Announcement');

    expect(ariaLive.textContent).toBe('Announcement');

    jest.advanceTimersByTime(1000);

    expect(ariaLive.textContent).toBe('');
  });

  test('handles empty message', () => {
    const ariaLive = document.getElementById('ariaLive')!;
    announceToScreenReader('');

    expect(ariaLive.textContent).toBe('');

    jest.advanceTimersByTime(1000);

    expect(ariaLive.textContent).toBe('');
  });

  test('handles missing ariaLive element gracefully', () => {
    document.body.innerHTML = '';
    expect(() => announceToScreenReader('Test')).not.toThrow();
  });

  test('announces different messages', () => {
    const ariaLive = document.getElementById('ariaLive')!;

    announceToScreenReader('First message');
    expect(ariaLive.textContent).toBe('First message');

    jest.advanceTimersByTime(500);

    announceToScreenReader('Second message');
    expect(ariaLive.textContent).toBe('Second message');

    jest.advanceTimersByTime(1000);

    expect(ariaLive.textContent).toBe('');
  });
});

describe('Re-exported helpers', () => {
  test('getBadgeClass is available via formatters export', () => {
    expect(typeof getBadgeClass).toBe('function');
    expect(getBadgeClass('Done')).toBe('badge-done');
  });

  test('formatStatus is available via formatters export', () => {
    expect(typeof formatStatus).toBe('function');
    expect(formatStatus('InProgress')).toBe('In Progress');
  });

  test('getFilesChanged is available via formatters export', () => {
    expect(typeof getFilesChanged).toBe('function');
    expect(getFilesChanged(null)).toEqual([]);
  });
});
