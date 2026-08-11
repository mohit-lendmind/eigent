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

// In-chat card for aion's durable human gate (SK-D): the run is parked
// awaiting_approval server-side, so the card is the reviewer surface. The
// verdict travels over the edge (respond-once backend); the card never
// resolves itself — approval_resolved streaming back is what flips it.

import { Check, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  PUBLISH_SKILL_TOOL,
  parseSkillPublishProposal,
} from '@/lib/approvalProposal';
import { respondToAionApproval } from '@/store/aionChatBridge';
import { Button } from '../../ui/button';

type ApprovalInfo = NonNullable<Message['approval']>;

export function ApprovalCard({ approval }: { approval: ApprovalInfo }) {
  const { t } = useTranslation();
  const [responding, setResponding] = useState(false);
  const resolved = approval.decision !== undefined;
  const proposal =
    approval.toolName === PUBLISH_SKILL_TOOL
      ? parseSkillPublishProposal(approval.argumentsJson)
      : null;

  const respond = async (decision: 'allow' | 'deny') => {
    setResponding(true);
    try {
      await respondToAionApproval(approval.projectId, approval.approvalId, decision);
      // Stay disabled: approval_resolved on the stream replaces the buttons.
    } catch {
      toast.error(t('chat.approval-respond-failed'));
      setResponding(false);
    }
  };

  return (
    <div
      data-testid="chat-approval-card"
      className="flex flex-col gap-3 rounded-xl border border-ds-border-neutral-default bg-ds-bg-neutral-default-default p-4"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert
          size={16}
          className="flex-shrink-0 text-ds-icon-neutral-default-default"
        />
        <span className="text-body-sm font-bold text-ds-text-neutral-default-default">
          {proposal
            ? t('chat.approval-publish-skill-title')
            : t('chat.approval-required', {
                tool: approval.toolName ?? 'a tool',
              })}
        </span>
      </div>
      {approval.reason ? (
        <div className="text-body-sm text-ds-text-neutral-muted-default">
          {approval.reason}
        </div>
      ) : null}
      {proposal ? (
        <div className="flex flex-col gap-1 rounded-lg bg-ds-bg-neutral-muted-default p-3">
          <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
            {proposal.name}
            {proposal.scope ? (
              <span className="ml-2 rounded-md bg-ds-bg-neutral-default-default px-1.5 py-0.5 text-label-xs font-medium text-ds-text-neutral-muted-default">
                {proposal.scope}
              </span>
            ) : null}
          </div>
          <div className="text-body-sm text-ds-text-neutral-muted-default">
            {proposal.description}
          </div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-label-xs text-ds-text-neutral-muted-default">
            {proposal.promptText}
          </pre>
        </div>
      ) : approval.argumentsJson ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ds-bg-neutral-muted-default p-3 text-label-xs text-ds-text-neutral-muted-default">
          {approval.argumentsJson}
        </pre>
      ) : null}
      {resolved ? (
        <div
          data-testid="chat-approval-decision"
          className="flex items-center gap-2 text-body-sm text-ds-text-neutral-muted-default"
        >
          {approval.decision === 'allow' ? (
            <>
              <Check size={14} className="flex-shrink-0" />
              {t('chat.approval-resolved-allow')}
            </>
          ) : (
            <>
              <X size={14} className="flex-shrink-0" />
              {t('chat.approval-resolved-deny')}
            </>
          )}
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={responding}
            onClick={() => void respond('deny')}
            data-testid="chat-approval-deny"
          >
            {t('chat.approval-deny')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={responding}
            onClick={() => void respond('allow')}
            data-testid="chat-approval-allow"
          >
            {t('chat.approval-allow')}
          </Button>
        </div>
      )}
    </div>
  );
}
