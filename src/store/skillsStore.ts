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

import {
  skillConfigDelete as brainSkillConfigDelete,
  skillConfigInit as brainSkillConfigInit,
  skillConfigLoad as brainSkillConfigLoad,
  skillConfigToggle as brainSkillConfigToggle,
  skillConfigUpdate as brainSkillConfigUpdate,
  skillDelete as brainSkillDelete,
  skillsScan as brainSkillsScan,
  skillWrite as brainSkillWrite,
} from '@/api/brain';
import { EdgeProblemError } from '@/api/aion/v1/problems';
import {
  buildSkillMd,
  buildSkillScopeTag,
  hasSkillsFsApi,
  parseSkillMd,
  skillNameToDirName,
} from '@/lib/skillToolkit';
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
import { useAuthStore } from './authStore';

/** The edge problem's own words when typed, the message otherwise. */
function remoteSkillErrorText(error: unknown): string {
  if (error instanceof EdgeProblemError) {
    return error.problem.detail ?? error.problem.title;
  }
  return error instanceof Error ? error.message : String(error);
}

function sanitizeSkillConfigId(value: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = String(value)
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace(/^\.+|\.+$/g, '');
  return sanitized || null;
}

function legacyEmailSkillConfigId(email: string | null): string | null {
  if (!email) return null;
  return sanitizeSkillConfigId(email.split('@')[0]);
}

function getSkillConfigUserIds(): {
  userId: string | null;
  legacyUserId: string | null;
} {
  const { email, user_id } = useAuthStore.getState();
  const sanitizedUserId = sanitizeSkillConfigId(user_id);
  return {
    userId: sanitizedUserId ? `user_${sanitizedUserId}` : null,
    legacyUserId: legacyEmailSkillConfigId(email),
  };
}

// Skill scope interface
export interface SkillScope {
  isGlobal: boolean;
  selectedAgents: string[];
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
}

// isExample is now determined dynamically by skills-scan based on whether
// the skill dir exists in resources/example-skills (no hardcoded list needed)

// Skills state interface
interface SkillsState {
  skills: Skill[];
  /**
   * How the backing skills provider resolved this renderer lifetime: 'local'
   * = filesystem via the local brain (unchanged legacy path); 'remote' = the
   * aion edge SkillStore; 'unsupported'/'error' = remote mode that cannot
   * serve skills — the screen shows a visible state, never a silent
   * fallback to local. Set by syncFromDisk.
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
  // Sync skills from the backing provider: the remote SkillStore when the
  // renderer runs in aion remote mode, else SKILL.md files on disk (Electron)
  syncFromDisk: () => Promise<void>;
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
        if (remote.kind !== 'local') {
          if (remote.kind !== 'remote') {
            throw new Error(
              remote.kind === 'error'
                ? remote.message
                : `The aion backend (edge API ${remote.edgeApiVersion}) predates the skills surface.`
            );
          }
          // The SKILL.md frontmatter is authoritative when parseable, exactly
          // like the local write path; problems (skill_invalid, skill_stale,
          // quota) propagate to the caller for inline rendering. Scope rides
          // the document's Metadata tag.
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

        // Persist to filesystem (Electron) as CAMEL-compatible SKILL.md
        if (hasSkillsFsApi()) {
          const meta = parseSkillMd(skill.fileContent);
          const name = meta?.name || skill.name;
          const description = meta?.description || skill.description;
          const body = meta?.body || skill.fileContent;
          const content = buildSkillMd(name, description, body);
          const dirName =
            skill.skillDirName || skillNameToDirName(name || 'skill');
          try {
            await brainSkillWrite(dirName, content);
          } catch (e) {
            console.warn('[Skills] brainSkillWrite failed:', e);
            // Ignore; UI still holds the in-memory skill
          }
          skill = {
            ...skill,
            filePath: `${dirName}/SKILL.md`,
            fileContent: content,
            skillDirName: dirName,
          };
        }

        const newSkill: Skill = {
          ...skill,
          id: generateId(),
          addedAt: Date.now(),
          isExample: false,
        };

        // Update local configuration via Brain REST API
        if (hasSkillsFsApi()) {
          try {
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (userId) {
              await brainSkillConfigUpdate(
                userId,
                newSkill.name,
                {
                  enabled: newSkill.enabled,
                  scope: newSkill.scope,
                  addedAt: newSkill.addedAt,
                  isExample: false,
                },
                legacyUserId
              );
            }
          } catch (error) {
            console.warn('[Skills] Failed to update skill config:', error);
            // Continue anyway - skill is added to UI
          }
        }

        set((state) => ({
          skills: [newSkill, ...state.skills],
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
        if (remote.kind !== 'local') {
          if (remote.kind !== 'remote') return;
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
          return;
        }

        // Persist to configuration file if updating scope or enabled status
        if (
          hasSkillsFsApi() &&
          (updates.scope || updates.enabled !== undefined)
        ) {
          try {
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (!userId) return;

            const updatedSkill = { ...skill, ...updates };
            await brainSkillConfigUpdate(
              userId,
              skill.name,
              {
                enabled: updatedSkill.enabled,
                scope: updatedSkill.scope,
                addedAt: updatedSkill.addedAt,
                isExample: updatedSkill.isExample,
              },
              legacyUserId
            );
            console.log(
              `[Skills] Updated config for skill: ${skill.name}`,
              updates
            );
          } catch (error) {
            console.error('[Skills] Failed to update skill config:', error);
            // Revert on error
            set((state) => ({
              skills: state.skills.map((s) => (s.id === id ? skill : s)),
            }));
          }
        }
      },

      deleteSkill: async (id) => {
        const current = get().skills.find((s) => s.id === id);
        if (!current) return;

        // Example skills cannot be deleted, only enabled/disabled
        if (current.isExample) return;

        const remote = await getAionSkillsMode();
        if (remote.kind !== 'local') {
          if (remote.kind !== 'remote') return;
          try {
            await deleteAionSkill(current.name);
            set((state) => ({
              skills: state.skills.filter((skill) => skill.id !== id),
            }));
          } catch (error) {
            // The row stays visible: a delete that did not land must not
            // vanish from the list only to reappear on the next sync.
            console.error('[Skills] remote delete failed:', error);
            toast.error(`Skill delete failed: ${remoteSkillErrorText(error)}`);
          }
          return;
        }

        // Delete from filesystem via Brain REST API
        if (current.skillDirName && hasSkillsFsApi()) {
          try {
            await brainSkillDelete(current.skillDirName);
          } catch (e) {
            console.warn('[Skills] brainSkillDelete failed:', e);
            // Ignore; state will still be updated
          }
        }

        // Delete from local configuration via Brain REST API
        if (hasSkillsFsApi()) {
          try {
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (userId) {
              await brainSkillConfigDelete(userId, current.name, legacyUserId);
            }
          } catch (error) {
            console.warn('[Skills] Failed to delete skill config:', error);
            // Continue anyway - skill is removed from UI
          }
        }

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
        if (remote.kind !== 'local') {
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
          return;
        }

        // Persist to local configuration via Brain REST API
        if (hasSkillsFsApi()) {
          try {
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (userId) {
              const result = await brainSkillConfigToggle(
                userId,
                skill.name,
                newEnabled,
                legacyUserId
              );
              if (!result.success) {
                throw new Error('Failed to toggle skill configuration');
              }
              console.log('Skill configuration updated:', result);
            }
          } catch (error) {
            // Revert on error
            console.error('Failed to toggle skill:', error);
            set((state) => ({
              skills: state.skills.map((s) =>
                s.id === id ? { ...s, enabled: !newEnabled } : s
              ),
            }));
          }
        }
      },

      getSkillsByType: (isExample) => {
        return get().skills.filter((skill) => skill.isExample === isExample);
      },

      // Load skills from ~/.eigent/skills via Brain REST API
      syncFromDisk: async () => {
        // Remote mode takes precedence over the filesystem flag: the edge
        // SkillStore is the source of truth, and a remote stack that cannot
        // serve skills surfaces that state instead of scanning local files.
        const remote = await getAionSkillsMode();
        if (remote.kind !== 'local') {
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
                message:
                  error instanceof Error ? error.message : String(error),
              },
            });
          }
          return;
        }

        if (!hasSkillsFsApi()) return;
        try {
          const { userId, legacyUserId } = getSkillConfigUserIds();

          const result = await brainSkillsScan();
          if (!result.success || !result.skills) return;

          if (userId) {
            console.log(`[Skills] Initializing config for user: ${userId}`);
            await brainSkillConfigInit(userId, legacyUserId);
          }

          let config: any = { global: null, project: null };
          try {
            if (userId) {
              console.log(`[Skills] Loading config for user: ${userId}`);
              const loadResult = await brainSkillConfigLoad(
                userId,
                legacyUserId
              );
              if (loadResult.success && loadResult.config) {
                config.global = loadResult.config;
                console.log(
                  `[Skills] Loaded config with ${Object.keys(loadResult.config.skills || {}).length} skills configured`
                );
              } else {
                console.warn('[Skills] Failed to load config');
              }
            } else {
              console.warn(
                '[Skills] No userId available, skipping config load'
              );
            }
          } catch (error) {
            console.error('[Skills] Error loading skill config:', error);
          }

          const prevByKey = new Map<string, Skill>(
            get().skills.map((s) => [s.skillDirName ?? s.id, s])
          );

          const diskSkills: Skill[] = [];
          for (const s of result.skills) {
            const existing = prevByKey.get(s.skillDirName);
            const isExample = s.isExample ?? false;

            // Get config from global/project (config key = skill name from SKILL.md)
            const globalConfig = config.global?.skills?.[s.name];
            const projectConfig = config.project?.skills?.[s.name];
            const skillConfig = projectConfig ?? globalConfig;

            // Register to config if not present (e.g. newly uploaded zip or single file)
            const isNewSkill = !skillConfig;
            if (isNewSkill && userId && hasSkillsFsApi()) {
              try {
                const addedAt = existing?.addedAt ?? Date.now();
                const newSkillConfig = {
                  enabled: true,
                  scope: { isGlobal: true, selectedAgents: [] },
                  addedAt,
                  isExample,
                };
                await brainSkillConfigUpdate(
                  userId,
                  s.name,
                  newSkillConfig,
                  legacyUserId
                );
                // Update in-memory config so subsequent skills in same sync see it
                if (!config.global) config.global = { skills: {} };
                if (!config.global.skills) config.global.skills = {};
                config.global.skills[s.name] = newSkillConfig;
              } catch (error) {
                console.warn(
                  `[Skills] Failed to register skill ${s.name} to config:`,
                  error
                );
              }
            }

            const effectiveConfig = isNewSkill
              ? {
                  enabled: true,
                  scope: { isGlobal: true, selectedAgents: [] },
                  addedAt: existing?.addedAt ?? Date.now(),
                  isExample,
                }
              : skillConfig;

            const enabledFromConfig = effectiveConfig?.enabled ?? true;
            let scopeFromConfig: SkillScope;
            if (
              effectiveConfig?.scope &&
              typeof effectiveConfig.scope === 'object'
            ) {
              scopeFromConfig = {
                isGlobal: effectiveConfig.scope.isGlobal ?? true,
                selectedAgents: effectiveConfig.scope.selectedAgents ?? [],
              };
            } else {
              scopeFromConfig = {
                isGlobal: true,
                selectedAgents: [],
              };
            }

            diskSkills.push({
              id: `disk-${s.skillDirName}`,
              name: s.name,
              description: s.description,
              filePath: s.path,
              fileContent: existing?.fileContent ?? '',
              skillDirName: s.skillDirName,
              addedAt:
                effectiveConfig?.addedAt ?? existing?.addedAt ?? Date.now(),
              scope: scopeFromConfig,
              enabled: enabledFromConfig,
              isExample: effectiveConfig?.isExample ?? isExample,
            });
          }
          diskSkills.sort((a: Skill, b: Skill) => a.name.localeCompare(b.name));

          set({ skills: diskSkills });
        } catch {
          // Ignore sync errors; keep existing state
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
