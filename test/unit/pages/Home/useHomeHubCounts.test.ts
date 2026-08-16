// The Home tab badges. Two of them read a plane the desktop may not be on: the
// local project array is empty on an aion stack and triggers have no local
// plane at all, so without the overrides the Triggers tab would badge "0"
// beside a list of N — and a trigger count is exactly the number a user checks
// instead of opening the tab.
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useHomeHubCounts } from '@/pages/Home/hooks/useHomeHubCounts';

vi.mock('@/store/spaceStore', () => ({
  isDisposableBlankSpace: () => false,
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({ activeSpaceId: '', spaces: {}, projectsBySpaceId: {} }),
}));

const localProjects: any[] = [{ id: 'p1' }, { id: 'p2' }];

describe('useHomeHubCounts', () => {
  it('counts the local plane when no aion override is given', () => {
    const { result } = renderHook(() => useHomeHubCounts(localProjects));
    expect(result.current.projects).toBe(2);
    // Triggers only exist on aion, so no override means nothing to count.
    expect(result.current.triggers).toBe(0);
  });

  it('lets aion own both counts when aion serves the lists', () => {
    // The local arrays are still empty here — that is the state an aion
    // desktop is actually in, and the badges must not report it.
    const { result } = renderHook(() => useHomeHubCounts([], 4, 9));
    expect(result.current.projects).toBe(4);
    expect(result.current.triggers).toBe(9);
  });

  it('keeps a real zero from aion rather than falling back to the local count', () => {
    const { result } = renderHook(() => useHomeHubCounts(localProjects, 0, 0));
    // A tenant with no triggers badges 0; `??` rather than `||` is what makes
    // that distinguishable from "aion did not answer".
    expect(result.current.projects).toBe(0);
    expect(result.current.triggers).toBe(0);
  });
});
