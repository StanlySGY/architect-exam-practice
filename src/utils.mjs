import { randomUUID } from "node:crypto";

export function clone(value) {
  return structuredClone(value);
}

export function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function sample(items, count, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.slice(0, count);
}

export function addDays(isoDate, days) {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
