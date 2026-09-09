import { useCallback, useEffect, useRef, useState } from 'react';
import { PicoBridge, type DetectedDevice } from '@/lib/pico-bridge';

export type PicoBridgeStatus = 'idle' | 'connecting' | 'connected' | 'error';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePicoBridge() {
  const [status, setStatus] = useState<PicoBridgeStatus>('idle');
  const [devices, setDevices] = useState<DetectedDevice[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const bridgeRef = useRef<PicoBridge | null>(null);

  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const fail = useCallback((error: unknown) => {
    bridgeRef.current = null;
    setStatus('error');
    setErrorMessage(errorText(error));
    setDevices([]);
  }, []);

  const connect = useCallback(async () => {
    if (bridgeRef.current || status === 'connecting') return;
    setStatus('connecting');
    setErrorMessage(null);
    try {
      const bridge = await PicoBridge.connect();
      bridgeRef.current = bridge;
      const scanned = await bridge.scan();
      setDevices(scanned);
      setStatus('connected');
    } catch (error) {
      fail(error);
    }
  }, [fail, status]);

  const rescan = useCallback(async () => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    try {
      setDevices(await bridge.scan());
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  const disconnect = useCallback(async () => {
    const bridge = bridgeRef.current;
    bridgeRef.current = null;
    if (bridge) await bridge.disconnect().catch(() => {});
    setStatus('idle');
    setDevices([]);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      void bridgeRef.current?.disconnect();
    };
  }, []);

  return { status, devices, errorMessage, isSupported, connect, disconnect, rescan, bridge: bridgeRef.current };
}
