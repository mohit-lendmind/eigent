// The browser card mirrors a page nobody can reach: the run's Chromium lives
// in a sandbox pod. What it shows is therefore the run's own published
// evidence, and these tests hold to which evidence it picks — a frame over a
// screenshot, a bounded window over every frame, and never an offer to take
// control of a browser that is not here.
import { describe, expect, it } from 'vitest';

import {
  BROWSER_FRAME_ARTIFACT_PREFIX,
  type BrowserFrame,
  type TimelineEntry,
} from '@/api/aion/v1/reducer';
import { projectBrowserView } from '@/store/aionChatBridge';

const RUN = 'run_01';

function frame(n: number): BrowserFrame {
  return {
    artifactId: `art_frame_${n}`,
    runId: RUN,
    sequence: String(n),
    name: `${BROWSER_FRAME_ARTIFACT_PREFIX}${n}.jpg`,
  };
}

function imageArtifact(artifactId: string): TimelineEntry {
  return {
    type: 'artifact',
    runId: RUN,
    sequence: '1',
    artifact: { artifact_id: artifactId, media_type: 'image/png', name: 'chart.png' },
  };
}

// A resolver that mints a URL for everything, and records what it was asked.
function resolver(asked: string[] = []) {
  return {
    asked,
    resolve: (artifactId: string) => {
      asked.push(artifactId);
      return `https://cas.example/${artifactId}`;
    },
  };
}

describe('projectBrowserView', () => {
  it('shows the newest frame and carries the strip in order', () => {
    const view = projectBrowserView(
      RUN,
      'https://example.com/page',
      [],
      [frame(1), frame(2), frame(3)],
      resolver().resolve
    );

    expect(view.frames).toEqual([
      'https://cas.example/art_frame_1',
      'https://cas.example/art_frame_2',
      'https://cas.example/art_frame_3',
    ]);
    expect(view.img).toBe('https://cas.example/art_frame_3');
    expect(view.url).toBe('https://example.com/page');
    expect(view.frameCount).toBe(3);
  });

  it('resolves only the tail, and still reports the true total', () => {
    // Every resolve mints a time-boxed grant, so a run that browsed for a
    // minute must not spend one per frame. The count is what keeps the
    // unresolved frames legible as older rather than as never taken.
    const r = resolver();
    const frames = Array.from({ length: 20 }, (_, i) => frame(i + 1));
    const view = projectBrowserView(RUN, '', [], frames, r.resolve);

    expect(view.frames).toHaveLength(8);
    expect(view.frames?.[7]).toBe('https://cas.example/art_frame_20');
    expect(view.frameCount).toBe(20);
    expect(r.asked).toHaveLength(8);
  });

  it('skips a frame whose URL has not been minted yet', () => {
    // Resolution is asynchronous and re-projects when it lands, so a frame
    // with no URL is omitted rather than rendered as a broken image.
    const view = projectBrowserView(
      RUN,
      '',
      [],
      [frame(1), frame(2)],
      (id) => (id === 'art_frame_1' ? 'https://cas.example/art_frame_1' : undefined)
    );
    expect(view.frames).toEqual(['https://cas.example/art_frame_1']);
    expect(view.img).toBe('https://cas.example/art_frame_1');
    expect(view.frameCount).toBe(2);
  });

  it('never offers to take control, on either path', () => {
    // "Take Control" attaches a WebContentsView. There is none for a pod
    // browser, so the affordance would do nothing at all.
    expect(projectBrowserView(RUN, '', [], [frame(1)], resolver().resolve).remote).toBe(
      true
    );
    expect(
      projectBrowserView(RUN, '', [imageArtifact('art_1')], [], resolver().resolve).remote
    ).toBe(true);
  });

  describe('a pod whose browserctl predates frames', () => {
    it('falls back to the last image artifact', () => {
      const view = projectBrowserView(
        RUN,
        '',
        [imageArtifact('art_1'), imageArtifact('art_2')],
        [],
        resolver().resolve
      );
      expect(view.img).toBe('https://cas.example/art_2');
      expect(view.frames).toEqual([]);
      expect(view.frameCount).toBe(0);
    });

    it('is not consulted once a single frame exists', () => {
      // The fallback matches any image the agent wrote — a chart it produced
      // would render as "the browser view". A real frame always outranks it.
      const r = resolver();
      const view = projectBrowserView(
        RUN,
        '',
        [imageArtifact('art_chart')],
        [frame(1)],
        r.resolve
      );
      expect(view.img).toBe('https://cas.example/art_frame_1');
      expect(r.asked).toEqual(['art_frame_1']);
    });
  });

  it('renders an empty picture rather than a stale one when nothing published', () => {
    const view = projectBrowserView(RUN, 'https://example.com', [], [], resolver().resolve);
    expect(view.img).toBe('');
    expect(view.frames).toEqual([]);
    expect(view.id).toBe(`aion:${RUN}:browser`);
    expect(view.processTaskId).toBe(RUN);
  });
});
