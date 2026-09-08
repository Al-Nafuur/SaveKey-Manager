import { useCallback, useEffect, useRef, useState } from 'react';
import { connectPicoBridge, type DetectedDevice, type PicoBridgeConnection } from '@/lib/pico-bridge';

export type PicoBridgeStatus = 'idle' | 'connecting' | 'connected' | 'error';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePicoBridge() {
  const [status, setStatus] = useState<PicoBridgeStatus>('idle');
  const [devices, setDevices] = useState<DetectedDevice[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const connectionRef = useRef<PicoBridgeConnection | null>(null);

  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const handleUnexpectedDisconnect = useCallback((error?: unknown) => {
    connectionRef.current = null;
    setDevices([]);
    setStatus(error ? 'error' : 'idle');
    setErrorMessage(error ? errorText(error) : null);
  }, []);

  const connect = useCallback(async () => {
    if (connectionRef.current || status === 'connecting') return;
    setStatus('connecting');
    setErrorMessage(null);
    try {
      const connection = await connectPicoBridge(setDevices, handleUnexpectedDisconnect);
      connectionRef.current = connection;
      setStatus('connected');
    } catch (error) {
      setStatus('error');
      setErrorMessage(errorText(error));
    }
  }, [handleUnexpectedDisconnect, status]);

  const disconnect = useCallback(async () => {
    const connection = connectionRef.current;
    connectionRef.current = null;
    if (connection) await connection.disconnect();
    setStatus('idle');
    setDevices([]);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      void connectionRef.current?.disconnect();
    };
  }, []);

  return { status, devices, errorMessage, isSupported, connect, disconnect };
}
