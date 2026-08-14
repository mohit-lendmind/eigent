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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { t } from 'i18next';

interface InstallationErrorDialogProps {
  backendError: string;
}

// The only way startup fails is an unusable aion edge configuration, which is
// read from the environment at main-process start — so there is nothing the
// user can retry from here; the message names what to fix.
const InstallationErrorDialog = ({
  backendError,
}: InstallationErrorDialogProps) => (
  <Dialog open={true}>
    <DialogContent size="sm">
      <DialogHeader title={t('layout.backend-startup-failed')} />
      <DialogContentSection>
        <div className="text-body-sm font-normal leading-normal text-ds-text-neutral-muted-default">
          <div className="mb-1">
            <span className="text-ds-text-neutral-muted-default">
              {backendError}
            </span>
          </div>
        </div>
      </DialogContentSection>
    </DialogContent>
  </Dialog>
);

export default InstallationErrorDialog;
