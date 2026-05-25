type PoolKind = 'uint8' | 'uint32' | 'int16' | 'float32';

export interface TypedArrayPoolStats {
  arrays: number;
  bytes: number;
  hits: number;
  misses: number;
}

type TypedPoolArray = Uint8Array | Uint32Array | Int16Array | Float32Array;

export class TypedArrayPool {
  private readonly pools: Record<PoolKind, Map<number, TypedPoolArray[]>> = {
    uint8: new Map(),
    uint32: new Map(),
    int16: new Map(),
    float32: new Map(),
  };
  private arrays = 0;
  private bytes = 0;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxArraysPerLength = 12,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  acquireUint8(length: number): Uint8Array {
    return this.acquire('uint8', length, () => new Uint8Array(length)) as Uint8Array;
  }

  acquireUint32(length: number): Uint32Array {
    return this.acquire('uint32', length, () => new Uint32Array(length)) as Uint32Array;
  }

  acquireInt16(length: number): Int16Array {
    return this.acquire('int16', length, () => new Int16Array(length)) as Int16Array;
  }

  acquireFloat32(length: number): Float32Array {
    return this.acquire('float32', length, () => new Float32Array(length)) as Float32Array;
  }

  release(array: TypedPoolArray | null | undefined): void {
    if (!array || array.length === 0) return;
    if (array instanceof Uint8Array) this.releaseInto('uint8', array);
    else if (array instanceof Uint32Array) this.releaseInto('uint32', array);
    else if (array instanceof Int16Array) this.releaseInto('int16', array);
    else if (array instanceof Float32Array) this.releaseInto('float32', array);
  }

  stats(): TypedArrayPoolStats {
    return {
      arrays: this.arrays,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
    };
  }

  private acquire(kind: PoolKind, length: number, factory: () => TypedPoolArray): TypedPoolArray {
    const bucket = this.pools[kind].get(length);
    const array = bucket?.pop();
    if (array) {
      this.arrays--;
      this.bytes -= array.byteLength;
      this.hits++;
      return array;
    }
    this.misses++;
    return factory();
  }

  private releaseInto(kind: PoolKind, array: TypedPoolArray): void {
    if (array.byteLength > this.maxBytes) return;
    if (this.bytes + array.byteLength > this.maxBytes) return;
    const pool = this.pools[kind];
    const bucket = pool.get(array.length) ?? [];
    if (bucket.length >= this.maxArraysPerLength) return;
    bucket.push(array);
    pool.set(array.length, bucket);
    this.arrays++;
    this.bytes += array.byteLength;
  }
}

export const sharedTypedArrayPool = new TypedArrayPool();
