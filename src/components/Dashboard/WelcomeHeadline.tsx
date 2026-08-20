// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import WordCarousel from '@/components/ui/WordCarousel';
import { useTranslation } from 'react-i18next';

/** User's local time: morning 5–12, afternoon 12–17, evening/night otherwise */
function timeGreetingKey(hour: number): string {
  if (hour >= 5 && hour < 12) return 'layout.greeting-morning';
  if (hour >= 12 && hour < 17) return 'layout.greeting-afternoon';
  return 'layout.greeting-evening';
}

function formatWelcomeName(raw: string): string {
  if (!raw) return '';
  if (/^[^@]+@gmail\.com$/i.test(raw)) {
    const local = raw.split('@')[0];
    const pretty = local.replace(/[._-]+/g, ' ').trim();
    return pretty
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return raw;
}

/**
 * The greeting is addressed to whoever we can name. Not every deployment can:
 * a backend may authenticate a tenant without carrying a display name for the
 * person, and there the greeting is the whole headline — punctuation written
 * around an absent name reads as a bug ("Evening , !"), which is worse than
 * not being greeted by name at all.
 */
export default function WelcomeHeadline({ name }: { name: string }) {
  const { t } = useTranslation();
  const welcomeName = formatWelcomeName(name);

  return (
    <div className="flex w-full flex-row bg-ds-bg-neutral-default-default px-6 py-5">
      <p
        className="m-0 inline-flex flex-wrap items-baseline gap-2"
        data-testid="welcome-headline"
      >
        <WordCarousel
          words={[t(timeGreetingKey(new Date().getHours()))]}
          className="history-welcome-headline text-heading-base not-italic"
          rotateIntervalMs={100}
          sweepDurationMs={2000}
          sweepOnce
          gradient="linear-gradient(90deg, var(--ds-text-brand-subtle-default) 0%, var(--ds-text-brand-muted-default) 100%)"
        />
        {welcomeName ? (
          <span className="history-welcome-headline text-heading-base italic text-ds-text-brand-default-default">
            {`, ${welcomeName} !`}
          </span>
        ) : null}
      </p>
    </div>
  );
}
