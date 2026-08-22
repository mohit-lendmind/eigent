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

// FR-015 — the CRM's left navigation rail (the "tactical rail"). M2 ships a
// single destination, the Today queue, so the rail's job is small: name the
// surface and give a visible, active nav entry. It is the CRM's own nav, kept
// out of the app's main Layout on purpose (the /crm route is a sibling).

import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

export function TacticalRail() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('crm.nav.crm')}
      className="flex w-48 flex-col gap-1 border-r border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3"
    >
      <span className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-ds-text-neutral-muted-default">
        {t('crm.nav.crm')}
      </span>
      <NavLink
        to="/crm"
        end
        className={({ isActive }) =>
          `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            isActive
              ? 'bg-ds-bg-brand-subtle-default text-ds-text-brand-strong-default'
              : 'text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-muted-default'
          }`
        }
      >
        <ListChecks className="h-4 w-4" aria-hidden />
        {t('crm.today.title')}
      </NavLink>
    </nav>
  );
}
