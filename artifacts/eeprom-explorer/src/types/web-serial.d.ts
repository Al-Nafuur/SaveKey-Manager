// Minimal ambient types for the Web Serial API — not shipped in TS's DOM lib
// and no @types package is installed for it. Only the subset actually used
// by src/lib/pico-bridge.ts is declared here.
export {};

declare global {
  interface SerialPortOpenOptions {
    baudRate: number;
  }

  interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: SerialPortOpenOptions): Promise<void>;
    close(): Promise<void>;
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }

  interface Serial extends EventTarget {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
  }

  interface Navigator {
    readonly serial?: Serial;
  }
}
