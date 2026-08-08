"use strict";
function zeptomatch(pattern, input) {
  if (pattern == null || pattern === "*") return true;
  if (typeof pattern !== "string" || typeof input !== "string") return false;
  if (!pattern.includes("*") && !pattern.includes("?")) return pattern === input;
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + esc + "$").test(input);
}
module.exports = zeptomatch;
module.exports.default = zeptomatch;
