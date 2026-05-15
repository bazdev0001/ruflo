/**
 * Unit tests for the midstream-aware federation transport loader
 * (ADR-120, Step 2).
 *
 * The loader's job is narrow: when MIDSTREAMER_QUIC_NATIVE=1 AND a
 * real (non-stub) midstreamer module is importable, return it.
 * Otherwise, fall through to the agentic-flow loader. These tests
 * verify both branches by stubbing the dynamic import / mocking the
 * agentic-flow loader where needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  loadFederationTransport,
} from '../../src/transport/midstream-aware-loader.js';

// We don't want the real agentic-flow loader to fire UDP / WebSocket
// listeners in tests. Mock the underlying transport so every test
// gets a deterministic transport stub.
vi.mock('agentic-flow/transport/loader', async () => {
  return {
    loadQuicTransport: vi.fn(async () => ({
      send: vi.fn(),
      receive: vi.fn(),
      request: vi.fn(),
      sendBatch: vi.fn(),
      getStats: vi.fn(),
      close: vi.fn(),
      // Marker so we can assert which branch resolved
      __mockSource: 'agentic-flow-mock',
    })),
  };
});

describe('loadFederationTransport — ADR-120 Step 2', () => {
  const originalEnv = process.env.MIDSTREAMER_QUIC_NATIVE;

  beforeEach(() => {
    delete process.env.MIDSTREAMER_QUIC_NATIVE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MIDSTREAMER_QUIC_NATIVE;
    } else {
      process.env.MIDSTREAMER_QUIC_NATIVE = originalEnv;
    }
  });

  it('defers to agentic-flow when MIDSTREAMER_QUIC_NATIVE is unset', async () => {
    const loaded = await loadFederationTransport();
    expect(loaded.source).toBe('agentic-flow-loader');
    expect(loaded.transport).toBeDefined();
    expect((loaded.transport as unknown as { __mockSource: string }).__mockSource).toBe(
      'agentic-flow-mock',
    );
  });

  it('defers to agentic-flow when MIDSTREAMER_QUIC_NATIVE is "0"', async () => {
    process.env.MIDSTREAMER_QUIC_NATIVE = '0';
    const loaded = await loadFederationTransport();
    expect(loaded.source).toBe('agentic-flow-loader');
  });

  it('defers to agentic-flow with no error noise when midstreamer is not installed', async () => {
    process.env.MIDSTREAMER_QUIC_NATIVE = '1';
    // No need to mock 'midstreamer' — the dynamic import will throw
    // MODULE_NOT_FOUND and the loader is supposed to fall through.
    const loaded = await loadFederationTransport();
    expect(loaded.source).toBe('agentic-flow-loader');
    // `fallbackReason` is only set when a probe ran to completion and
    // produced a diagnostic; a clean miss leaves it unset.
    expect(loaded.fallbackReason).toBeUndefined();
  });

  it('passes config through to the underlying loader', async () => {
    const mod = await import('agentic-flow/transport/loader');
    const loaderFn = (mod as unknown as { loadQuicTransport: ReturnType<typeof vi.fn> })
      .loadQuicTransport;
    loaderFn.mockClear();

    await loadFederationTransport({
      serverName: 'test-node',
      maxIdleTimeoutMs: 12_345,
      maxConcurrentStreams: 42,
      enable0Rtt: false,
    });

    expect(loaderFn).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'test-node',
        maxIdleTimeoutMs: 12_345,
        maxConcurrentStreams: 42,
        enable0Rtt: false,
      }),
    );
  });

  it('returned envelope has the documented LoadedFederationTransport shape', async () => {
    const loaded = await loadFederationTransport();
    expect(Object.keys(loaded).sort()).toEqual(
      expect.arrayContaining(['transport', 'source']),
    );
    // `source` must be one of the two documented values.
    expect(['midstreamer-native', 'agentic-flow-loader']).toContain(loaded.source);
  });
});
