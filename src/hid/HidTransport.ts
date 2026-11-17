import type { CollectionInfo, RawOp, ReportInfo, RequestOptions, Tap, Transport } from './types';

const DEFAULT_REPORT_SIZE = 32;

/**
 * A feature report normally completes in a few milliseconds. If one never settles (e.g. while
 * another program such as the vendor driver talks to the keyboard), fail it instead of letting
 * it block every later command in the queue.
 */
const FEATURE_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out. Is another program (e.g. the VTER driver) using it?`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface Waiter {
  match: (r: Uint8Array) => boolean;
  resolve: (r: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const reportList = (reports: HIDReportInfo[] | undefined): ReportInfo[] =>
  (reports ?? []).map((r) => ({
    id: r.reportId ?? 0,
    size: Math.ceil(
      (r.items ?? []).reduce((sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0) / 8,
    ),
  }));

/** Flattens the device's report descriptor into plain data (top-level collections only). */
export function describeCollections(device: HIDDevice): CollectionInfo[] {
  return (device.collections ?? []).map((c) => ({
    usagePage: c.usagePage ?? 0,
    usage: c.usage ?? 0,
    input: reportList(c.inputReports),
    output: reportList(c.outputReports),
    feature: reportList(c.featureReports),
  }));
}

const isVendorPage = (page: number) => page >= 0xff00;

/**
 * WebHID transport. Serialises requests so a response is always paired with the
 * command that caused it, pads every report to the descriptor's size and times out
 * requests the firmware never answers.
 */
export class HidTransport implements Transport {
  readonly isMock = false;
  readonly collections: CollectionInfo[];
  readonly reportId: number;
  readonly reportSize: number;
  tap: Tap | null = null;

  private queue: Promise<unknown> = Promise.resolve();
  private waiter: Waiter | null = null;

  constructor(
    readonly device: HIDDevice,
    reportId?: number,
  ) {
    this.collections = describeCollections(device);
    // Default to the first output report on a vendor-defined collection.
    const outputs = this.collections
      .filter((c) => isVendorPage(c.usagePage))
      .concat(this.collections)
      .flatMap((c) => c.output);
    const chosen = reportId !== undefined ? outputs.find((r) => r.id === reportId) : outputs[0];
    this.reportId = reportId ?? chosen?.id ?? 0;
    this.reportSize = chosen?.size || DEFAULT_REPORT_SIZE;
  }

  get name() {
    return this.device.productName || 'HID keyboard';
  }
  get vendorId() {
    return this.device.vendorId;
  }
  get productId() {
    return this.device.productId;
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this.onInputReport);
  }

  async close() {
    this.device.removeEventListener('inputreport', this.onInputReport);
    this.failWaiter(new Error('Device closed'));
    if (this.device.opened) await this.device.close();
  }

  write(payload: Uint8Array): Promise<void> {
    return this.enqueue(() => this.sendOutput(this.reportId, payload));
  }

  request(payload: Uint8Array, opts: RequestOptions = {}) {
    return this.enqueue(() => this.outputAndWait(this.reportId, payload, opts));
  }

  raw(op: RawOp): Promise<Uint8Array | null> {
    return this.enqueue(async () => {
      switch (op.kind) {
        case 'output':
          if (op.awaitInput) return this.outputAndWait(op.reportId, op.data, { timeoutMs: 1500 });
          await this.sendOutput(op.reportId, op.data);
          return null;
        case 'feature-set': {
          const report = this.pad(op.data, this.sizeOf('feature', op.reportId));
          this.tap?.('tx', report);
          await withTimeout(this.device.sendFeatureReport(op.reportId, report), FEATURE_TIMEOUT_MS, 'Sending to the keyboard');
          return null;
        }
        case 'feature-get': {
          const view = await withTimeout(
            this.device.receiveFeatureReport(op.reportId),
            FEATURE_TIMEOUT_MS,
            'Reading from the keyboard',
          );
          const data = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
          this.tap?.('rx', data);
          return data;
        }
      }
    });
  }

  /** Payload size of a report from the descriptor (falls back to the default report size). */
  private sizeOf(type: 'output' | 'feature', reportId: number): number {
    const r = this.collections.flatMap((c) => c[type]).find((x) => x.id === reportId);
    return r?.size || this.reportSize;
  }

  private async sendOutput(reportId: number, payload: Uint8Array) {
    const report = this.pad(payload, this.sizeOf('output', reportId));
    this.tap?.('tx', report);
    await this.device.sendReport(reportId, report);
  }

  private outputAndWait(
    reportId: number,
    payload: Uint8Array,
    { timeoutMs = 1000, match = () => true }: RequestOptions,
  ) {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`No response within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiter = { match, resolve, reject, timer };
      this.sendOutput(reportId, payload).catch((err: unknown) => {
        this.failWaiter(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private onInputReport = (event: HIDInputReportEvent) => {
    const { buffer, byteOffset, byteLength } = event.data;
    const data = new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength));
    this.tap?.('rx', data);
    const w = this.waiter;
    if (w && w.match(data)) {
      clearTimeout(w.timer);
      this.waiter = null;
      w.resolve(data);
    }
  };

  private failWaiter(err: Error) {
    const w = this.waiter;
    if (!w) return;
    clearTimeout(w.timer);
    this.waiter = null;
    w.reject(err);
  }

  private pad(payload: Uint8Array, size: number): Uint8Array {
    const report = new Uint8Array(size);
    report.set(payload.subarray(0, size));
    return report;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
