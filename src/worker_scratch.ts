export interface WorkerScratchStats {
  scratchBytes: number;
  scratchReuses: number;
  transferBytes: number;
  transferAllocations: number;
}

export class WorkerScratchArena {
  private floatScratch = new Float32Array(0);
  private scratchReuses = 0;
  private transferBytes = 0;
  private transferAllocations = 0;

  acquireFloat32(length: number): Float32Array {
    if (this.floatScratch.length >= length) {
      this.scratchReuses++;
      return this.floatScratch;
    }
    this.floatScratch = new Float32Array(length);
    return this.floatScratch;
  }

  copyUint8(source: Uint8Array): Uint8Array {
    const out = new Uint8Array(source.byteLength);
    out.set(source);
    this.recordTransfer(out.byteLength);
    return out;
  }

  copyUint32(source: Uint32Array): Uint32Array {
    const out = new Uint32Array(source.length);
    out.set(source);
    this.recordTransfer(out.byteLength);
    return out;
  }

  copyInt16(source: Int16Array): Int16Array {
    const out = new Int16Array(source.length);
    out.set(source);
    this.recordTransfer(out.byteLength);
    return out;
  }

  copyFloat32(source: Float32Array): Float32Array {
    const out = new Float32Array(source.length);
    out.set(source);
    this.recordTransfer(out.byteLength);
    return out;
  }

  stats(): WorkerScratchStats {
    return {
      scratchBytes: this.floatScratch.byteLength,
      scratchReuses: this.scratchReuses,
      transferBytes: this.transferBytes,
      transferAllocations: this.transferAllocations,
    };
  }

  private recordTransfer(bytes: number): void {
    if (bytes <= 0) return;
    this.transferBytes += bytes;
    this.transferAllocations++;
  }
}
