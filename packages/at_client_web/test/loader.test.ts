import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBridge, setBridgeLoader, type Bridge } from '../src/loader.js';

const fakeBridge = {} as Bridge;

afterEach(() => {
  setBridgeLoader();
  vi.unstubAllGlobals();
});

describe('loadBridge with an injected loader', () => {
  it('does not load until asked', () => {
    const loader = vi.fn(async () => fakeBridge);
    setBridgeLoader(loader);
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads once however many calls and callers', async () => {
    const loader = vi.fn(async () => fakeBridge);
    setBridgeLoader(loader);
    const [a, b] = await Promise.all([loadBridge(), loadBridge()]);
    const c = await loadBridge();
    expect(loader).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual([fakeBridge, fakeBridge, fakeBridge]);
  });

  it('retries after a failed load', async () => {
    const loader = vi
      .fn<() => Promise<Bridge>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(fakeBridge);
    setBridgeLoader(loader);
    await expect(loadBridge()).rejects.toThrow('network');
    expect(await loadBridge()).toBe(fakeBridge);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps a loader installed while an earlier load was failing', async () => {
    let failEarlier!: (error: Error) => void;
    setBridgeLoader(() => new Promise<Bridge>((_, reject) => (failEarlier = reject)));
    const earlier = loadBridge();
    const settled = expect(earlier).rejects.toThrow('late');

    const replacement = vi.fn(async () => fakeBridge);
    setBridgeLoader(replacement);
    expect(await loadBridge()).toBe(fakeBridge);

    failEarlier(new Error('late'));
    await settled;
    expect(await loadBridge()).toBe(fakeBridge);
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});

describe('the default loader', () => {
  function stubDocument() {
    const scripts: Array<{
      src: string;
      onload?: (() => void) | null;
      onerror?: (() => void) | null;
      removed: boolean;
      remove: () => void;
    }> = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const script: (typeof scripts)[number] = {
          src: '',
          removed: false,
          remove() {
            script.removed = true;
          },
        };
        scripts.push(script);
        return script;
      },
      head: { appendChild: () => {} },
    });
    return scripts;
  }

  it('injects dart/at_client.js once and resolves with the global it installs', async () => {
    const scripts = stubDocument();
    const [a, b] = [loadBridge(), loadBridge()];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toMatch(/\/dart\/at_client\.js$/);
    vi.stubGlobal('__atsignAtClientWeb', fakeBridge);
    scripts[0]!.onload!();
    expect(await a).toBe(fakeBridge);
    expect(await b).toBe(fakeBridge);
    expect(await loadBridge()).toBe(fakeBridge);
    expect(scripts).toHaveLength(1);
  });

  it('reuses a bridge that is already installed without injecting', async () => {
    const scripts = stubDocument();
    vi.stubGlobal('__atsignAtClientWeb', fakeBridge);
    expect(await loadBridge()).toBe(fakeBridge);
    expect(scripts).toHaveLength(0);
  });

  it('rejects with an internal AtError when the script fails to load', async () => {
    const scripts = stubDocument();
    const loading = loadBridge();
    scripts[0]!.onerror!();
    await expect(loading).rejects.toMatchObject({ name: 'AtError', code: 'internal' });
    expect(scripts[0]!.removed).toBe(true);
  });

  it('injects a fresh script on the retry after a failed load', async () => {
    const scripts = stubDocument();
    const first = loadBridge();
    scripts[0]!.onerror!();
    await expect(first).rejects.toMatchObject({ code: 'internal' });
    const second = loadBridge();
    expect(scripts).toHaveLength(2);
    vi.stubGlobal('__atsignAtClientWeb', fakeBridge);
    scripts[1]!.onload!();
    expect(await second).toBe(fakeBridge);
    expect(scripts[1]!.removed).toBe(false);
  });

  it('rejects with an internal AtError when the script installs nothing', async () => {
    vi.useFakeTimers();
    try {
      const scripts = stubDocument();
      const loading = loadBridge();
      const settled = expect(loading).rejects.toMatchObject({ code: 'internal' });
      scripts[0]!.onload!();
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;
      expect(scripts[0]!.removed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a bundle request that never loads rejects timeout after 60 s', async () => {
    vi.useFakeTimers();
    try {
      const scripts = stubDocument();
      const loading = loadBridge();
      const settled = expect(loading).rejects.toMatchObject({
        name: 'AtError',
        code: 'timeout',
        message: 'the bridge bundle did not load within 60 s',
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;
      expect(scripts[0]!.removed).toBe(true);
      expect(scripts[0]!.onload).toBeNull();
      expect(scripts[0]!.onerror).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a create after a timed-out bundle load injects the bundle again', async () => {
    vi.useFakeTimers();
    try {
      const scripts = stubDocument();
      const first = loadBridge();
      const settled = expect(first).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;

      const second = loadBridge();
      expect(scripts).toHaveLength(2);
      vi.stubGlobal('__atsignAtClientWeb', fakeBridge);
      scripts[1]!.onload!();
      expect(await second).toBe(fakeBridge);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the bundle deadline covers a slow download and the install', async () => {
    vi.useFakeTimers();
    try {
      const slow = stubDocument();
      const loading = loadBridge();
      await vi.advanceTimersByTimeAsync(59_000);
      slow[0]!.onload!();
      await vi.advanceTimersByTimeAsync(500);
      vi.stubGlobal('__atsignAtClientWeb', fakeBridge);
      await vi.advanceTimersByTimeAsync(10);
      await expect(loading).resolves.toBe(fakeBridge);
      expect(slow[0]!.removed).toBe(false);

      setBridgeLoader();
      vi.unstubAllGlobals();
      const late = stubDocument();
      const expired = loadBridge();
      const settled = expect(expired).rejects.toMatchObject({
        code: 'timeout',
        message: 'the bridge bundle did not load within 60 s',
      });
      await vi.advanceTimersByTimeAsync(59_900);
      late[0]!.onload!();
      await vi.advanceTimersByTimeAsync(100);
      await settled;
      expect(late[0]!.removed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
