// wasm_helper/index.js
// Go WebAssembly runtime for Node.js
// Faithfully ported from Python wasm_helper/__init__.py

'use strict';

const { Memory, FsObject, ProcessObject } = require('./helper');

// Mirrors Python: undefined = ContextVar("undefined")
const UNDEF = Symbol('undefined');

// ─── globalThis (mirrors Python globalThis class) ─────────────────────────────
const global_this = {
  exports: UNDEF,
  window: {
    document: { we_love_mb: true }, // From CookieGMVN Library :)
  },
  fs: new FsObject(),
  process: new ProcessObject(),
  location: { origin: 'https://online.mbbank.com.vn' },
  Object: Object,
  Array: Array,
  Uint8Array: Uint8Array,
  bder: undefined,
};

// ─── GO class ─────────────────────────────────────────────────────────────────
class GO {
  constructor() {
    this.argv = ['js'];
    this.env = {};
    this._pendingEvent = null;
    this._scheduledTimeouts = {};
    this._nextCallbackTimeoutID = 1;
  }

  setInt64(addr, v) {
    this.mem.setUint32(addr + 0, v | 0, true);
    this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
  }

  getInt64(addr) {
    const low  = this.mem.getUint32(addr + 0, true);
    const high = this.mem.getInt32(addr + 4, true);
    return low + high * 4294967296;
  }

  loadValue(addr) {
    const f = this.mem.getFloat64(addr, true);
    if (f === 0) return undefined;
    if (!isNaN(f)) return f;
    const id = this.mem.getInt32(addr, true);
    return this._values[id];
  }

  storeValue(addr, v) {
    const nanHead = 0x7FF80000;

    if (typeof v === 'number' && v !== 0) {
      if (isNaN(v)) {
        this.mem.setInt32(addr + 4, nanHead, true);
        this.mem.setUint32(addr, 0, true);
        return;
      }
      this.mem.setFloat64(addr, v, true);
      return;
    }

    if (v === undefined || v === UNDEF) {
      this.mem.setFloat64(addr, 0, true);
      return;
    }

    let id = this._ids.get(v);
    if (id === undefined) {
      id = this._idPool.length > 0 ? this._idPool.pop() : this._values.length;
      while (this._values.length <= id) this._values.push(undefined);
      while (this._goRefCounts.length <= id) this._goRefCounts.push(Infinity);
      this._values[id] = v;
      this._goRefCounts[id] = 0;
      this._ids.set(v, id);
    }

    this._goRefCounts[id]++;

    let typeFlag = 1;
    if (v === null)                typeFlag = 0;
    else if (typeof v === 'string')   typeFlag = 2;
    else if (typeof v === 'symbol')   typeFlag = 3;
    else if (typeof v === 'function') typeFlag = 4;

    this.mem.setInt32(addr + 4, nanHead | typeFlag, true);
    this.mem.setInt32(addr, id, true);
  }

  loadSlice(addr) {
    const array = this.getInt64(addr + 0);
    const len   = this.getInt64(addr + 8);
    return [new Uint8Array(this.mem.buffer, array, len), array, len];
  }

  loadSliceOfValues(addr) {
    const array = this.getInt64(addr + 0);
    const len   = this.getInt64(addr + 8);
    const result = [];
    for (let i = 0; i < len; i++) result.push(this.loadValue(array + i * 8));
    return result;
  }

  loadString(addr) {
    const array = this.getInt64(addr + 0);
    const len   = this.getInt64(addr + 8);
    return Buffer.from(new Uint8Array(this.mem.buffer, array, len)).toString('utf8');
  }

  // ── GOJS methods ─────────────────────────────────────────────────────────────

  _rt_wasmExit(sp) {
    const code = this.mem.getInt32(sp + 8, true);
    this.exited = true;
    console.log('exit code:', code);
  }

  _rt_wasmWrite(sp) {
    sp = sp >>> 0;
    const fd = this.getInt64(sp + 8);
    const p  = this.getInt64(sp + 16);
    const n  = this.mem.getInt32(sp + 24, true);
    global_this.fs.writeSync(fd, new Uint8Array(this.mem.buffer, p, n));
  }

  _rt_resetMemoryDataView(_sp) {}

  _rt_nanotime1(sp) {
    sp = sp >>> 0;
    const nsec = BigInt(Math.floor(Date.now())) * 1000000n;
    this.mem.setBigInt64(sp + 8, nsec, true);
  }

  _rt_walltime(sp) {
    sp = sp >>> 0;
    const msec = Date.now();
    this.setInt64(sp + 8, msec / 1000);
    this.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
  }

  _rt_scheduleTimeoutEvent(_sp) {}
  _rt_clearTimeoutEvent(_sp) {}

  _rt_getRandomData(sp) {
    sp = sp >>> 0;
    const [, start, len] = this.loadSlice(sp + 8);
    const rnd = require('crypto').randomBytes(len);
    new Uint8Array(this.mem.buffer).set(rnd, start);
  }

  _sysjs_finalizeRef(sp) {
    sp = sp >>> 0;
    const id = this.mem.getUint32(sp + 8, true);
    if (this._goRefCounts[id] === 0) {
      const v = this._values[id];
      this._values[id] = null;
      this._ids.delete(v);
      this._idPool.push(id);
    }
  }

  _sysjs_stringVal(sp) {
    sp = sp >>> 0;
    const str = this.loadString(sp + 8);
    this.storeValue(sp + 24, str);
  }

  _sysjs_valueGet(sp) {
    sp = sp >>> 0;
    const obj  = this.loadValue(sp + 8);
    const name = this.loadString(sp + 16);
    const result = (obj !== null && obj !== undefined) ? obj[name] : undefined;
    sp = this._inst.exports.getsp() >>> 0;
    this.storeValue(sp + 32, result);
  }

  _sysjs_valueSet(sp) {
    sp = sp >>> 0;
    const obj  = this.loadValue(sp + 8);
    const name = this.loadString(sp + 16);
    const val  = this.loadValue(sp + 32);
    obj[name] = val;
  }

  _sysjs_valueDelete(sp) {
    sp = sp >>> 0;
    delete this.loadValue(sp + 8)[this.loadString(sp + 16)];
  }

  _sysjs_valueIndex(sp) {
    sp = sp >>> 0;
    const obj = this.loadValue(sp + 8);
    const idx = this.getInt64(sp + 16);
    this.storeValue(sp + 24, obj[idx]);
  }

  _sysjs_valueSetIndex(_sp) {}

  _sysjs_valueCall(sp) {
    sp = sp >>> 0;
    try {
      const v    = this.loadValue(sp + 8);
      const name = this.loadString(sp + 16);
      const args = this.loadSliceOfValues(sp + 32);
      const result = v[name].apply(v, args);
      sp = this._inst.exports.getsp() >>> 0;
      this.storeValue(sp + 56, result);
      this.mem.setUint8(sp + 64, 1);
    } catch (err) {
      console.error(err);
      sp = this._inst.exports.getsp() >>> 0;
      this.storeValue(sp + 56, err);
      this.mem.setUint8(sp + 64, 0);
    }
  }

  _sysjs_valueInvoke(_sp) {}
  _sysjs_valueNew(_sp) {}

  _sysjs_valueLength(sp) {
    sp = sp >>> 0;
    this.setInt64(sp + 16, this.loadValue(sp + 8).length);
  }

  _sysjs_valuePrepareString(sp) {
    sp = sp >>> 0;
    let v = this.loadValue(sp + 8);
    if (typeof v === 'number') v = Math.trunc(v);
    const encoded = Buffer.from(String(v), 'utf8');
    this.storeValue(sp + 16, encoded);
    this.setInt64(sp + 24, encoded.length);
  }

  _sysjs_valueLoadString(sp) {
    sp = sp >>> 0;
    const strData   = this.loadValue(sp + 8);
    const [, start] = this.loadSlice(sp + 16);
    new Uint8Array(this.mem.buffer).set(strData, start);
  }

  _sysjs_valueInstanceOf(_sp) {}
  _sysjs_copyBytesToGo(_sp) {}
  _sysjs_copyBytesToJS(_sp) {}
  _debug(_v) {}

  // ── Function map (field name → handler) ─────────────────────────────────────
  // Mirrors Python GOJS.__getattribute__ name remapping:
  //   "runtime.X"    → rt_X
  //   "syscall/js.X" → sysjs_X
  _buildFuncMap() {
    const go = this;
    return {
      'runtime.wasmExit':               (sp) => go._rt_wasmExit(sp),
      'runtime.wasmWrite':              (sp) => go._rt_wasmWrite(sp),
      'runtime.resetMemoryDataView':    (sp) => go._rt_resetMemoryDataView(sp),
      'runtime.nanotime1':              (sp) => go._rt_nanotime1(sp),
      'runtime.walltime':               (sp) => go._rt_walltime(sp),
      'runtime.scheduleTimeoutEvent':   (sp) => go._rt_scheduleTimeoutEvent(sp),
      'runtime.clearTimeoutEvent':      (sp) => go._rt_clearTimeoutEvent(sp),
      'runtime.getRandomData':          (sp) => go._rt_getRandomData(sp),
      'syscall/js.finalizeRef':         (sp) => go._sysjs_finalizeRef(sp),
      'syscall/js.stringVal':           (sp) => go._sysjs_stringVal(sp),
      'syscall/js.valueGet':            (sp) => go._sysjs_valueGet(sp),
      'syscall/js.valueSet':            (sp) => go._sysjs_valueSet(sp),
      'syscall/js.valueDelete':         (sp) => go._sysjs_valueDelete(sp),
      'syscall/js.valueIndex':          (sp) => go._sysjs_valueIndex(sp),
      'syscall/js.valueSetIndex':       (sp) => go._sysjs_valueSetIndex(sp),
      'syscall/js.valueCall':           (sp) => go._sysjs_valueCall(sp),
      'syscall/js.valueInvoke':         (sp) => go._sysjs_valueInvoke(sp),
      'syscall/js.valueNew':            (sp) => go._sysjs_valueNew(sp),
      'syscall/js.valueLength':         (sp) => go._sysjs_valueLength(sp),
      'syscall/js.valuePrepareString':  (sp) => go._sysjs_valuePrepareString(sp),
      'syscall/js.valueLoadString':     (sp) => go._sysjs_valueLoadString(sp),
      'syscall/js.valueInstanceOf':     (sp) => go._sysjs_valueInstanceOf(sp),
      'syscall/js.copyBytesToGo':       (sp) => go._sysjs_copyBytesToGo(sp),
      'syscall/js.copyBytesToJS':       (sp) => go._sysjs_copyBytesToJS(sp),
      'debug':                          (v)  => go._debug(v),
    };
  }

  /**
   * Build importObject by inspecting the compiled WASM module's import list.
   * Mirrors Python: iterates imports_type and maps i.name → handler.
   * This automatically handles whatever module namespace the WASM declares
   * ("go", "gojs", or anything else).
   */
  buildImportObject(wasmModule) {
    const funcMap      = this._buildFuncMap();
    const importObject = {};

    for (const imp of WebAssembly.Module.imports(wasmModule)) {
      if (imp.kind !== 'function') continue;

      const ns = imp.module; // "gojs", "go", etc.
      const fn = imp.name;   // "runtime.wasmExit", etc.

      if (!importObject[ns]) importObject[ns] = {};

      if (funcMap[fn]) {
        importObject[ns][fn] = funcMap[fn];
      } else {
        console.warn(`[WASM] Unknown import ${ns}.${fn} — no-op`);
        importObject[ns][fn] = () => {};
      }
    }

    return importObject;
  }

  // ── run() — mirrors Python GO.run() ─────────────────────────────────────────
  run(instance) {
    this._inst = instance;
    this.mem   = new Memory(instance.exports.mem);

    this._values      = [NaN, 0, null, true, false, global_this, this];
    this._goRefCounts = new Array(50).fill(Infinity);
    this._ids = new Map([
      [0,           1],
      [null,        2],
      [true,        3],
      [false,       4],
      [global_this, 5],
      [this,        6],
    ]);
    this._idPool = [];
    this.exited  = false;

    let offset = 4096;

    const strPtr = (str) => {
      const ptr   = offset;
      const bytes = Buffer.from(str + '\0', 'utf8');
      this.mem.write(bytes, offset);
      offset += bytes.length;
      if (offset % 8 !== 0) offset += 8 - (offset % 8);
      return ptr;
    };

    const argvPtrs = this.argv.map(strPtr);
    argvPtrs.push(0);
    Object.keys(this.env).sort().forEach(k => argvPtrs.push(strPtr(`${k}=${this.env[k]}`)));
    argvPtrs.push(0);

    const argv = offset;
    for (const ptr of argvPtrs) {
      this.mem.setUint32(offset,     ptr, true);
      this.mem.setUint32(offset + 4, 0,   true);
      offset += 8;
    }

    if (offset >= 4096 + 8192) {
      throw new Error('command line + env vars exceed limit');
    }

    instance.exports.run(this.argv.length, argv);
  }

  _resume() {
    if (this.exited) throw new Error('Go program has already exited');
    this._inst.exports.resume();
  }

  _makeFuncWrapper(id) {
    const go = this;
    return function (...args) {
      const event = { id: Number(id), args, this: global_this, result: undefined };
      go._pendingEvent = event;
      go._resume();
      return event.result;
    };
  }
}

// ─── Cache after first init (mirrors Python global_this.bder check) ───────────
let cachedBder = null;

/**
 * wasmEncrypt — mirrors Python wasm_encrypt()
 */
async function wasmEncrypt(wasmBytes, jsonData) {
  if (cachedBder !== null) {
    return cachedBder(JSON.stringify(jsonData), '0');
  }

  const go = new GO();

  // Compile to inspect imports — mirrors Python wasmtime.Module(engine, wasm_files)
  const wasmModule = await WebAssembly.compile(wasmBytes);

  // Log actual namespaces for debugging
  const namespaces = [...new Set(WebAssembly.Module.imports(wasmModule).map(i => i.module))];

  const importObject = go.buildImportObject(wasmModule);
  const instance     = await WebAssembly.instantiate(wasmModule, importObject);

  go.run(instance);

  if (typeof global_this.bder !== 'function') {
    throw new Error('WASM init failed: global_this.bder is not a function after run()');
  }

  cachedBder = global_this.bder;
  return cachedBder(JSON.stringify(jsonData), '0');
}

module.exports = { wasmEncrypt };
