// The Home tab badges. Two of them read a plane the desktop may not be on: the
// local project array and the hosted trigger-count query are both empty on an
// aion stack, so without the overrides the Triggers tab would badge "0" beside
// a list of N — and a trigger count is exactly the number a user checks instead
// of opening the tab.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHomeHubCounts } from '@/pages/Home/hooks/useHomeHubCounts';

const mocks = vi.hoisted(() => ({
  hostedTriggerCount: 0,
}));

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useUserTriggerCountQuery: () => ({ data: mocks.hostedTriggerCount }),
}));

vi.mock('@/store/spaceStore', () => ({
  isDisposableBlankSpace: () => false,
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({ activeSpaceId: '', spaces: {}, projectsBySpaceId: {} }),
}));

const localProjects: any[] = [{ id: 'p1' }, { id: 'p2' }];

beforeEach(() => {
  mocks.hostedTriggerCount = 0;
});

describe('useHomeHubCounts', () => {
  it('counts the local plane when no aion override is given', () => {
    mocks.hostedTriggerCount = 7;
    const { result } = renderHook(() => useHomeHubCounts(localProjects));
    expect(result.current.projects).toBe(2);
    expect(result.current.triggers).toBe(7);
  });

  it('lets aion own both counts when aion serves the lists', () => {
    // The local arrays are still empty here — that is the state an aion
    // desktop is actually in, and the badges must not report it.
    const { result } = renderHook(() => useHomeHubCounts([], 4, 9));
    expect(result.current.projects).toBe(4);
    expect(result.current.triggers).toBe(9);
  });

  it('keeps a real zero from aion rather than falling back to the legacy count', () => {
    mocks.hostedTriggerCount = 7;
    const { result } = renderHook(() => useHomeHubCounts(localProjects, 0, 0));
    // A tenant with no triggers badges 0; `??` rather than `||` is what makes
    // that distinguishable from "aion did not answer".
    expect(result.current.projects).toBe(0);
    expect(result.current.triggers).toBe(0);
  });
});
