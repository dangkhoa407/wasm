// helper.js - Memory management and helper classes for Go WASM runtime

'use strict';

/**
 * Memory wrapper for WebAssembly memory operations
 * Mirrors Python Memory class behavior using DataView
 */
class Memory {
  constructor(wasmMemory) {
    this.mem = wasmMemory;
    this.WASM_PAGE_SIZE = 65536;
  }

  get buffer() {
    return this.mem.buffer;
  }

  get view() {
    return new DataView(this.mem.buffer);
  }

  read(start, end) {
    return new Uint8Array(this.mem.buffer, start, end - start);
  }

  write(value, startAddress) {
    const needed = startAddress + value.length;
    const currentSize = this.mem.buffer.byteLength;
    if (currentSize < needed) {
      const growPages = Math.ceil((needed - currentSize) / this.WASM_PAGE_SIZE);
      this.mem.grow(growPages);
    }
    const buf = new Uint8Array(this.mem.buffer);
    buf.set(value, startAddress);
  }

  getBigInt64(addr, littleEndian = false) {
    return this.view.getBigInt64(addr, littleEndian);
  }

  getBigUint64(addr, littleEndian = false) {
    return this.view.getBigUint64(addr, littleEndian);
  }

  getFloat32(addr, littleEndian = false) {
    return this.view.getFloat32(addr, littleEndian);
  }

  getFloat64(addr, littleEndian = false) {
    return this.view.getFloat64(addr, littleEndian);
  }

  getInt8(addr) {
    return this.view.getInt8(addr);
  }

  getInt16(addr, littleEndian = false) {
    return this.view.getInt16(addr, littleEndian);
  }

  getInt32(addr, littleEndian = false) {
    return this.view.getInt32(addr, littleEndian);
  }

  getUint8(addr) {
    return this.view.getUint8(addr);
  }

  getUint16(addr, littleEndian = false) {
    return this.view.getUint16(addr, littleEndian);
  }

  getUint32(addr, littleEndian = false) {
    return this.view.getUint32(addr, littleEndian);
  }

  setBigInt64(addr, value, littleEndian = false) {
    this.view.setBigInt64(addr, BigInt(value), littleEndian);
  }

  setBigUint64(addr, value, littleEndian = false) {
    this.view.setBigUint64(addr, BigInt(value), littleEndian);
  }

  setFloat32(addr, value, littleEndian = false) {
    this.view.setFloat32(addr, value, littleEndian);
  }

  setFloat64(addr, value, littleEndian = false) {
    this.view.setFloat64(addr, value, littleEndian);
  }

  setInt8(addr, value) {
    this.view.setInt8(addr, value);
  }

  setInt16(addr, value, littleEndian = false) {
    this.view.setInt16(addr, value, littleEndian);
  }

  setInt32(addr, value, littleEndian = false) {
    this.view.setInt32(addr, value, littleEndian);
  }

  setUint8(addr, value) {
    this.view.setUint8(addr, value);
  }

  setUint16(addr, value, littleEndian = false) {
    this.view.setUint16(addr, value, littleEndian);
  }

  setUint32(addr, value, littleEndian = false) {
    value = value >>> 0; // Convert to unsigned 32-bit
    this.view.setUint32(addr, value, littleEndian);
  }
}

/**
 * Simulates the Node.js fs module for Go WASM runtime
 */
class FsObject {
  constructor() {
    this.outputBuf = '';
    this.constants = {
      O_WRONLY: -1,
      O_RDWR: -1,
      O_CREAT: -1,
      O_TRUNC: -1,
      O_APPEND: -1,
      O_EXCL: -1,
    };
  }

  writeSync(fd, buf) {
    const text = Buffer.from(buf).toString('utf8');
    this.outputBuf += text;
    const nl = this.outputBuf.lastIndexOf('\n');
    if (nl !== -1) {
      process.stdout.write(this.outputBuf.slice(0, nl + 1));
      this.outputBuf = this.outputBuf.slice(nl + 1);
    }
    return buf.length;
  }

  write(fd, buf, offset, length, position, callback) {
    const n = this.writeSync(fd, buf.slice(offset, offset + length));
    callback(null, n);
  }
}

/**
 * Simulates process object for Go WASM runtime
 */
class ProcessObject {
  constructor() {
    this.pid = process.pid || -1;
    this.ppid = -1;
  }

  getuid() { return process.getuid ? process.getuid() : -1; }
  getgid() { return process.getgid ? process.getgid() : -1; }
  geteuid() { return process.geteuid ? process.geteuid() : -1; }
  getegid() { return process.getegid ? process.getegid() : -1; }
}

module.exports = { Memory, FsObject, ProcessObject };
