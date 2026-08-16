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

/**
 * Names a worker for this workforce: what it is called and what it is for.
 *
 * Tools and models are deliberately not here. Both are the server's to
 * decide — a worker's toolset comes from the profile the backend spawns it
 * with, and the model comes from the alias pinned on the Project — so a
 * per-worker picker for either could only ever record a preference nothing
 * downstream reads. What the name does carry is skill scope: a skill can be
 * pointed at this worker by name, which is why the workforce keeps a list
 * the user can edit at all.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { Bot, Edit } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function AddWorker({
  edit = false,
  workerInfo = null,
  variant: _variant = 'default',
  isOpen,
  onOpenChange,
}: {
  edit?: boolean;
  workerInfo?: Agent | null;
  variant?: 'default' | 'icon';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);

  // Use controlled state if provided, otherwise internal state
  const isControlled =
    typeof isOpen !== 'undefined' && typeof onOpenChange !== 'undefined';
  const dialogOpen = isControlled ? isOpen : internalOpen;
  const setDialogOpen = isControlled ? onOpenChange : setInternalOpen;
  const { setWorkerList } = useAuthStore();
  const workerList = useWorkerList();
  const [workerName, setWorkerName] = useState('');
  const [workerDescription, setWorkerDescription] = useState('');
  const [nameError, setNameError] = useState<string>('');

  useEffect(() => {
    if (!dialogOpen || !edit || !workerInfo) return;
    setWorkerName(workerInfo.workerInfo?.name || '');
    setWorkerDescription(workerInfo.workerInfo?.description || '');
  }, [dialogOpen, edit, workerInfo]);

  const resetForm = () => {
    setWorkerName('');
    setWorkerDescription('');
    setNameError('');
  };

  const handleAddWorker = () => {
    setNameError('');

    if (!workerName) {
      setNameError(t('workforce.worker-name-cannot-be-empty'));
      return;
    }

    if (!edit && workerList.find((worker) => worker.name === workerName)) {
      setNameError(t('workforce.worker-name-already-exists'));
      return;
    }

    const worker: Agent = {
      tasks: [],
      agent_id: workerName,
      name: workerName,
      type: workerName as AgentNameType,
      log: [],
      activeWebviewIds: [],
      workerInfo: {
        name: workerName,
        description: workerDescription,
      },
    };

    if (edit) {
      setWorkerList(
        workerList.map((existing) =>
          existing.type === workerInfo?.type ? worker : existing
        )
      );
    } else {
      setWorkerList([...workerList, worker]);
    }

    setDialogOpen(false);
    resetForm();
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <form>
        <DialogTrigger asChild>
          {edit && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={(e) => {
                e.stopPropagation();
                setDialogOpen(true);
                setWorkerName(workerInfo?.workerInfo?.name || '');
                setWorkerDescription(workerInfo?.workerInfo?.description || '');
              }}
            >
              <Edit size={16} />
              {t('workforce.edit')}
            </Button>
          )}
        </DialogTrigger>
        <DialogContent size="md" className="gap-0 p-0">
          <DialogHeader
            title={t('workforce.add-your-agent')}
            tooltip={t('layout.configure-your-mcp-worker-node-here')}
            showTooltip={true}
          />

          <DialogContentSection className="scrollbar-always-visible flex flex-col gap-3 overflow-y-auto p-md">
            <div className="flex items-center gap-sm">
              <div className="flex h-16 w-16 items-center justify-center">
                <Bot
                  size={32}
                  className="text-ds-icon-neutral-default-default"
                />
              </div>
              <Input
                size="sm"
                title={t('layout.name-your-agent')}
                placeholder={t('layout.add-an-agent-name')}
                value={workerName}
                onChange={(e) => {
                  setWorkerName(e.target.value);
                  if (nameError) setNameError('');
                }}
                state={nameError ? 'error' : 'default'}
                note={nameError || ''}
                required
              />
            </div>

            <Textarea
              variant="enhanced"
              size="sm"
              title={t('workforce.description-optional')}
              placeholder={t('layout.im-an-agent-specially-designed-for')}
              value={workerDescription}
              onChange={(e) => setWorkerDescription(e.target.value)}
            />
          </DialogContentSection>
          <DialogFooter
            className="!rounded-b-xl bg-ds-bg-neutral-subtle-default p-md"
            showCancelButton={true}
            showConfirmButton={true}
            cancelButtonText={t('workforce.cancel')}
            confirmButtonText={t('workforce.save-changes')}
            onCancel={() => {
              resetForm();
              setDialogOpen(false);
            }}
            onConfirm={handleAddWorker}
            cancelButtonVariant="ghost"
            confirmButtonVariant="primary"
          />
        </DialogContent>
      </form>
    </Dialog>
  );
}
