const b = require("@whiskeysockets/baileys");
const keys = Object.keys(b);
console.log("Has default:", typeof b.default);
console.log("Matching keys:", keys.filter(k => k.toLowerCase().includes("socket") || k.toLowerCase().includes("make") || k === "default"));
