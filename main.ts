// A tiny stack VM for make.fun's tiny stack ISA v1, matching the ISA exactly:
// 32-bit wrapping arithmetic (Math.imul for MUL), signed and unsigned division,
// all ten traps, the 1,000,000 step limit, the 65,536 byte output limit.
//   node main.ts [inputRoot] [outputRoot]     (defaults: /input and /output)
// Each <id> under the input root: run <id>/program.bin on <id>/input.bin,
// write <id>/stdout.bin and <id>/exit.txt under the output root.
// Deterministic: no clock, no randomness, no environment.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode [immediate bytes, values popped, values pushed], indexed by the
// opcode byte; a hole is an unknown opcode (trap 5). The stack checks use
// these counts before the instruction's own traps, in the ISA's order.
const META = [
 [0,0,0],[1,0,1],[4,0,1],[0,1,0],[0,1,2],[0,2,2],[0,2,3],
 [0,3,3],,,,,,,,,[0,2,1],[0,2,1],[0,2,1],[0,2,1],
 [0,2,1],[0,2,1],[0,2,1],[0,1,1],[0,2,1],[0,2,1],[0,2,1],
 [0,1,1],[0,2,1],[0,2,1],[0,2,1],,[0,2,1],[0,2,1],
 [0,2,1],,,,,,,,,,,,,,[2,0,0],[2,1,0],[2,1,0],
 [2,0,0],[0,0,0],,,,,,,,,,,,[0,1,1],[0,2,0],,,,,
 ,,,,,,,,,,[0,1,0],[0,1,0],[0,0,1],[0,1,0],
];

// Runs one program to its end; returns { out, code }: the bytes it wrote and
// the code it exited or trapped with. A trap keeps the output written so far.
function run(P, I) {
 const n = P.length;
 const D = new Int32Array(256); // data stack, at most 256 values
 const C = new Int32Array(64); // return addresses, at most 64
 const M = new Int32Array(256); // memory words, all zero at the start
 const O = new Uint8Array(65536); // output, at most 65,536 bytes
 let sp = 0, cp = 0, ol = 0, ip = 0, pc = 0, steps = 0;
 const fin = (code) => ({ out: O.slice(0, ol), code });
 for (;;) {
  if (steps === 1000000) return fin(10); // step limit
  if (pc < 0 || pc >= n) return fin(9); // pc outside the program
  const op = P[pc];
  const meta = META[op];
  if (meta === undefined) return fin(5); // unknown opcode
  if (pc + meta[0] >= n) return fin(9); // immediate cut off by the end
  steps++;
  const nx = pc + 1 + meta[0]; // address of the next instruction
  if (sp < meta[1]) return fin(2); // stack underflow
  if (sp - meta[1] + meta[2] > 256) return fin(3); // stack overflow
  pc = nx;
  switch (op) {
   case 0: // HALT
    return fin(0);
   case 1: // PUSH8: the byte as a signed 8-bit number
    D[sp++] = (P[nx - 1] << 24) >> 24;
    break;
   case 2: // PUSH32: four bytes, little-endian, signed
    D[sp++] = P[nx - 4] | (P[nx - 3] << 8) | (P[nx - 2] << 16) | (P[nx - 1] << 24);
    break;
   case 3: // POP
    sp--;
    break;
   case 4: // DUP
    D[sp] = D[sp - 1];
    sp++;
    break;
   case 5: { // SWAP
    const t = D[sp - 1];
    D[sp - 1] = D[sp - 2];
    D[sp - 2] = t;
    break;
   }
   case 6: // OVER
    D[sp] = D[sp - 2];
    sp++;
    break;
   case 7: { // ROT: ( a b c -- b c a )
    const a = D[sp - 3];
    D[sp - 3] = D[sp - 2];
    D[sp - 2] = D[sp - 1];
    D[sp - 1] = a;
    break;
   }
   case 23: // NEG: wraps, -(-2147483648) is -2147483648
    D[sp - 1] = -D[sp - 1] | 0;
    break;
   case 27: // NOT
    D[sp - 1] = ~D[sp - 1];
    break;
   case 16: case 17: case 18: case 19: case 20: case 21: case 22:
   case 24: case 25: case 26: case 28: case 29: case 30:
   case 32: case 33: case 34: { // the two-operand instructions
    const b = D[sp - 1];
    const a = D[sp - 2];
    let r;
    if (op === 16) r = (a + b) | 0;
    else if (op === 17) r = (a - b) | 0;
    else if (op === 18) r = Math.imul(a, b); // MUL: low 32 bits, exact
    else if (op === 19) { // DIV: truncated toward zero
     if (b === 0) return fin(4);
     r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
    } else if (op === 20) { // MOD: the sign of a; x % -1 is 0
     if (b === 0) return fin(4);
     r = b === -1 ? 0 : (a % b) | 0;
    } else if (op === 21) { // DIVU: both read as unsigned
     if (b === 0) return fin(4);
     r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
    } else if (op === 22) { // MODU
     if (b === 0) return fin(4);
     r = ((a >>> 0) % (b >>> 0)) | 0;
    } else if (op === 24) r = a & b;
    else if (op === 25) r = a | b;
    else if (op === 26) r = a ^ b;
    else if (op === 28) r = a << (b & 31); // shifts: only the low 5 bits
    else if (op === 29) r = a >> (b & 31); // SHR arithmetic, SHRU logical
    else if (op === 30) r = (a >>> (b & 31)) | 0;
    else if (op === 32) r = a === b ? 1 : 0;
    else if (op === 33) r = a < b ? 1 : 0; // LT signed, LTU unsigned
    else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU: unsigned
    D[sp - 2] = r;
    sp--;
    break;
   }
   case 48: case 49: case 50: { // JMP, JZ, JNZ: signed 16-bit offset from
    const rel = ((P[nx - 2] | (P[nx - 1] << 8)) << 16) >> 16; // the next
    let take = op === 48; // instruction; target unchecked until it steps
    if (op !== 48) {
     const v = D[--sp];
     take = op === 49 ? v === 0 : v !== 0;
    }
    if (take) pc = nx + rel;
    break;
   }
   case 51: // CALL: the immediate is an unsigned address
    if (cp === 64) return fin(7);
    C[cp++] = nx;
    pc = P[nx - 2] | (P[nx - 1] << 8);
    break;
   case 52: // RET
    if (cp === 0) return fin(8);
    pc = C[--cp];
    break;
   case 64: { // LOAD
    const a = D[sp - 1];
    if (a < 0 || a > 255) return fin(6);
    D[sp - 1] = M[a];
    break;
   }
   case 65: { // STORE: ( v addr -- )
    const a = D[sp - 1];
    if (a < 0 || a > 255) return fin(6);
    M[a] = D[sp - 2];
    sp -= 2;
    break;
   }
   case 80: { // PRINT: the value in decimal ASCII, no newline
    const s = '' + D[sp - 1];
    if (ol + s.length > 65536) return fin(11); // writes none of its bytes
    sp--;
    for (let k = 0; k < s.length; k++) O[ol++] = s.charCodeAt(k);
    break;
   }
   case 81: // PUTC: one byte, v AND 255
    if (ol + 1 > 65536) return fin(11);
    O[ol++] = D[--sp] & 255;
    break;
   case 82: // IN: the next input byte, -1 once the input is used up
    D[sp++] = ip < I.length ? I[ip++] : -1;
    break;
   case 83: // EXIT: the code is v AND 255
    return fin(D[--sp] & 255);
  }
 }
}

const IN = process.argv[2] ?? '/input';
const OUT = process.argv[3] ?? '/output';
for (const id of readdirSync(IN).sort()) {
 let prog;
 try {
  prog = readFileSync(join(IN, id, 'program.bin'));
 } catch {
  continue; // not an instance directory
 }
 let inp;
 try {
  inp = readFileSync(join(IN, id, 'input.bin'));
 } catch {
  inp = Buffer.alloc(0);
 }
 const r = run(prog, inp);
 mkdirSync(join(OUT, id), { recursive: true });
 writeFileSync(join(OUT, id, 'stdout.bin'), r.out);
 writeFileSync(join(OUT, id, 'exit.txt'), r.code + '\n');
}
