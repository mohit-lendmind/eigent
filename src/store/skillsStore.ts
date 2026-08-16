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

import { EdgeProblemError } from '@/api/aion/v1/problems';
import { buildSkillScopeTag, parseSkillMd } from '@/lib/skillToolkit';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  captureAionSyncUpCandidates,
  deleteAionSkill,
  getAionSkillsMode,
  listAionSkills,
  putAionSkill,
  setAionSkillEnabled,
  type AionSkillsMode,
} from './aionSkillsStore';

/** The edge problem's own words when typed, the message otherwise. */
function remoteSkillErrorText(error: unknown): string {
  if (error instanceof EdgeProblemError) {
    return error.problem.detail ?? error.problem.title;
  }
  return error instanceof Error ? error.message : String(error);
}

// Skill scope interface
export interface SkillScope {
  isGlobal: boolean;
  selectedAgents: string[];
}

/**
 * How a skill has actually been used, counted per name across its versions.
 * `activations` are automatic injections, `loads` are the agent asking for the
 * prompt, `executions` are runs that REACHED the sandbox at any exit code —
 * reach, not success.
 */
export interface SkillUsage {
  activations: number;
  loads: number;
  executions: number;
  /**
   * RFC 3339, kept verbatim from the wire. The contract omits it only for a
   * row that has no usage object at all, so a present usage always has one.
   */
  lastUsedAt: string;
}

// Skill interface
export interface Skill {
  id: string;
  name: string;
  description: string;
  filePath: string;
  fileContent: string;
  // Optional: folder name under ~/.eigent/skills
  skillDirName?: string;
  addedAt: number;
  scope: SkillScope;
  enabled: boolean;
  isExample: boolean;
  /**
   * Absent for a provider that does not count usage AND for a counted skill
   * nobody has used. The two are told apart by the provider, not the row:
   * `usageTracked(remoteMode)` says whether absence means "never used".
   */
  usage?: SkillUsage;
}

// isExample is now determined dynamically by skills-scan based on whether
// the skill dir exists in resources/example-skills (no hardcoded list needed)

// Skills state interface
interface SkillsState {
  skills: Skill[];
  /**
   * How the backing skills provider resolved this renderer lifetime:
   * 'remote' = the aion edge SkillStore, the only store there is;
   * 'unsupported'/'error' = a remote stack that cannot serve skills, which
   * the screen shows as a visible state rather than degrading silently;
   * 'local' = no transport reached the renderer at all (tests, a browser
   * build), so rows live in this store's own persisted state and nowhere
   * else. Set by refresh().
   */
  remoteMode: AionSkillsMode;
  /** Resolves with ignored_fields when the remote store stripped any. */
  addSkill: (
    skill: Omit<Skill, 'id' | 'addedAt' | 'isExample'>
  ) => Promise<{ ignoredFields: string[] } | undefined>;
  updateSkill: (id: string, updates: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  toggleSkill: (id: string) => Promise<void>;
  getSkillsByType: (isExample: boolean) => Skill[];
  /** Re-read the list from the SkillStore and republish the resolved mode. */
  refresh: () => Promise<void>;
}

// Generate unique ID
const generateId = () =>
  `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Create store
export const useSkillsStore = create<SkillsState>()(
  persist(
    (set, get) => ({
      skills: [],
      remoteMode: { kind: 'local' },

      addSkill: async (skill) => {
        const remote = await getAionSkillsMode();
        if (remote.kind === 'remote') {
          // The SKILL.md frontmatter is authoritative when parseable;
          // problems (skill_invalid, skill_stale, quota) propagate to the
          // caller for inline rendering. Scope rides the document's
          // Metadata tag.
          const meta = parseSkillMd(skill.fileContent);
          const result = await putAionSkill(
            {
              name: meta?.name || skill.name,
              description: meta?.description || skill.description,
              body: meta?.body ?? skill.fileContent,
            },
            [],
            { scope: buildSkillScopeTag(skill.scope) }
          );
          set({ skills: await listAionSkills() });
          return { ignoredFields: result.ignored_fields ?? [] };
        }
        if (remote.kind !== 'local') {
          throw new Error(
            remote.kind === 'error'
              ? remote.message
              : `The aion backend (edge API ${remote.edgeApiVersion}) predates the skills surface.`
          );
        }

        set((state) => ({
          skills: [
            {
              ...skill,
              id: generateId(),
              addedAt: Date.now(),
              isExample: false,
            },
            ...state.skills,
          ],
        }));
      },

      updateSkill: async (id, updates) => {
        const skill = get().skills.find((s) => s.id === id);
        if (!skill) return;

        set((state) => ({
          skills: state.skills.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));

        const remote = await getAionSkillsMode();
        if (remote.kind === 'remote') {
          try {
            if (updates.enabled !== undefined) {
              await setAionSkillEnabled(skill.name, updates.enabled);
            }
            if (updates.scope) {
              // Scope rides the stored document's Metadata tag: re-put
              // the document with the new tag; the content comes from the row
              // we already render, so nothing else changes.
              const meta = parseSkillMd(skill.fileContent);
              await putAionSkill(
                {
                  name: skill.name,
                  description: meta?.description || skill.description,
                  body: meta?.body ?? skill.fileContent,
                },
                [],
                { scope: buildSkillScopeTag(updates.scope) }
              );
            }
          } catch (error) {
            // A partial failure (status landed, scope re-put did not) makes
            // a blanket revert lie about remote state: re-list to converge,
            // and only fall back to the revert when the list also fails.
            console.error('[Skills] remote skill update failed:', error);
            toast.error(`Skill update failed: ${remoteSkillErrorText(error)}`);
            try {
              set({ skills: await listAionSkills() });
            } catch {
              set((state) => ({
                skills: state.skills.map((s) => (s.id === id ? skill : s)),
              }));
            }
          }
        }
        // Without a store to write to, the optimistic update above is the
        // whole update: it survives in the persisted rows and nowhere else.
      },

      deleteSkill: async (id) => {
        const current = get().skills.find((s) => s.id === id);
        if (!current) return;

        // Example skills cannot be deleted, only enabled/disabled
        if (current.isExample) return;

        const remote = await getAionSkillsMode();
        if (remote.kind === 'remote') {
          try {
            await deleteAionSkill(current.name);
            set((state) => ({
              skills: state.skills.filter((skill) => skill.id !== id),
            }));
          } catch (error) {
            // The row stays visible: a delete that did not land must not
            // vanish from the list only to reappear on the next refresh.
            console.error('[Skills] remote delete failed:', error);
            toast.error(`Skill delete failed: ${remoteSkillErrorText(error)}`);
          }
          return;
        }
        if (remote.kind !== 'local') return;

        set((state) => ({
          skills: state.skills.filter((skill) => skill.id !== id),
        }));
      },

      toggleSkill: async (id) => {
        const skill = get().skills.find((s) => s.id === id);
        if (!skill) return;

        const newEnabled = !skill.enabled;

        // Optimistically update UI
        set((state) => ({
          skills: state.skills.map((s) =>
            s.id === id ? { ...s, enabled: newEnabled } : s
          ),
        }));

        const remote = await getAionSkillsMode();
        if (remote.kind !== 'remote') return;
        try {
          await setAionSkillEnabled(skill.name, newEnabled);
        } catch (error) {
          // Revert on error
          console.error('Failed to toggle skill:', error);
          toast.error(`Skill toggle failed: ${remoteSkillErrorText(error)}`);
          set((state) => ({
            skills: state.skills.map((s) =>
              s.id === id ? { ...s, enabled: !newEnabled } : s
            ),
          }));
        }
      },

      getSkillsByType: (isExample) => {
        return get().skills.filter((skill) => skill.isExample === isExample);
      },

      refresh: async () => {
        const remote = await getAionSkillsMode();
        set({ remoteMode: remote });
        if (remote.kind !== 'remote') return;
        try {
          const remoteSkills = await listAionSkills();
          // Snapshot the persisted local rows BEFORE the remote list
          // replaces them — the one-time sync-up dialog offers this copy.
          // Filtering by remote names needs the fetched list, so the
          // capture sits between fetch and replace.
          captureAionSyncUpCandidates(
            get().skills,
            new Set(remoteSkills.map((skill) => skill.name))
          );
          set({ skills: remoteSkills });
        } catch (error) {
          set({
            remoteMode: {
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    }),
    {
      name: 'skills-storage',
      partialize: (state) => ({
        skills: state.skills,
      }),
    }
  )
);

// Non-hook version for use outside React components
export const getSkillsStore = () => useSkillsStore.getState();
