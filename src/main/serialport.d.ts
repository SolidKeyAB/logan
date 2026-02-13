// Type declarations for serialport (resolved at runtime via dynamic import)
declare module 'serialport' {
  export class SerialPort {
    constructor(options: { path: string; baudRate: number; autoOpen?: boolean });
    static list(): Promise<Array<{
      path: string;
      manufacturer?: string;
      vendorId?: string;
      productId?: string;
    }>>;
    open(callback: (err: Error | null) => void): void;
    close(callback?: (err: Error | null) => void): void;
    on(event: 'data', callback: (data: Buffer) => void): this;
    on(event: 'error', callback: (err: Error) => void): this;
    on(event: 'close', callback: () => void): this;
    isOpen: boolean;
  }
}
