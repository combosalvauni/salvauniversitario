import * as b from '@whiskeysockets/baileys';
console.log("Has default:", typeof b.default);
if (typeof b.default === 'function') {
  console.log("default is a function — use: default()");
} else if (typeof b.default === 'object' && b.default !== null) {
  const dkeys = Object.keys(b.default);
  console.log("default keys:", dkeys.filter(k => k.toLowerCase().includes("socket") || k.toLowerCase().includes("make")));
  console.log("default.default:", typeof b.default.default);
}
const topKeys = Object.keys(b).filter(k => k.toLowerCase().includes("socket") || k.toLowerCase().includes("make"));
console.log("Top-level matching:", topKeys);
