// The greeting is the first thing on the screen, and it is addressed to
// someone. A backend that authenticates a tenant without carrying a display
// name leaves nobody to address, and the headline has to hold up anyway.
import { render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WelcomeHeadline from '@/components/Dashboard/WelcomeHeadline';
import enUsLayout from '@/i18n/locales/en-us/layout.json';

vi.mock('react-i18next', async () => {
  const layout = (await import('@/i18n/locales/en-us/layout.json'))
    .default as Record<string, string>;
  return {
    useTranslation: () => ({
      t: (key: string) =>
        key.startsWith('layout.')
          ? (layout[key.slice('layout.'.length)] ?? key)
          : key,
    }),
  };
});

// WordCarousel animates its word in; the headline's text is what matters here.
vi.mock('@/components/ui/WordCarousel', () => ({
  default: ({ words }: { words: string[] }) => <span>{words[0]}</span>,
}));

function headlineAt(hour: number, name: string): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 14, hour, 30, 0));
  // Scoped to this render's own container: the hour cases render repeatedly
  // inside one test, and a global query would find every one of them.
  const { container } = render(<WelcomeHeadline name={name} />);
  return within(container).getByTestId('welcome-headline').textContent ?? '';
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WelcomeHeadline', () => {
  it('greets without a name rather than punctuating around an empty one', () => {
    // The regression: "Evening , !" — the comma and the exclamation are
    // written around the name, so an absent name strands them both.
    const text = headlineAt(20, '');

    expect(text).toBe('Evening');
    expect(text).not.toContain(',');
    expect(text).not.toContain('!');
  });

  it('greets by name when there is one', () => {
    expect(headlineAt(20, 'Mohit')).toBe('Evening, Mohit !');
  });

  it('reads a name out of a gmail address', () => {
    expect(headlineAt(20, 'ada.lovelace@gmail.com')).toBe(
      'Evening, Ada Lovelace !'
    );
  });

  it('picks the greeting from the local hour', () => {
    expect(headlineAt(5, '')).toBe('Morning');
    expect(headlineAt(11, '')).toBe('Morning');
    expect(headlineAt(12, '')).toBe('Good Afternoon');
    expect(headlineAt(16, '')).toBe('Good Afternoon');
    expect(headlineAt(17, '')).toBe('Evening');
    expect(headlineAt(4, '')).toBe('Evening');
  });

  it('translates every greeting it can ask for', () => {
    const layout = enUsLayout as Record<string, string>;
    for (const key of [
      'greeting-morning',
      'greeting-afternoon',
      'greeting-evening',
    ]) {
      expect(layout[key], key).toBeTruthy();
    }
  });
});
