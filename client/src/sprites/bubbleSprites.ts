import type { SpriteData } from '../types/office';

const _ = '';
const K = '#555566'; // border
const F = '#eeeeff'; // fill
const G = '#44bb66'; // green (done)
const A = '#cca700'; // amber (processing dots)
const R = '#dd4444'; // red (error)
const B = '#4488ff'; // blue (handoff)

// Small bubble (11x13) - processing (three dots)
export const BUBBLE_PROCESSING: SpriteData = [
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, K, F, F, F, F, F, F, F, K, _],
  [K, F, F, F, F, F, F, F, F, F, K],
  [K, F, F, A, F, A, F, A, F, F, K],
  [K, F, F, F, F, F, F, F, F, F, K],
  [_, K, F, F, F, F, F, F, F, K, _],
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, _, _, _, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, _, _, _, _, _],
];

// Small bubble - done (checkmark)
export const BUBBLE_DONE: SpriteData = [
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, K, F, F, F, F, F, F, F, K, _],
  [K, F, F, F, F, F, F, G, F, F, K],
  [K, F, F, F, F, F, G, F, F, F, K],
  [K, F, G, F, F, G, F, F, F, F, K],
  [K, F, F, G, G, F, F, F, F, F, K],
  [_, K, F, F, F, F, F, F, F, K, _],
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, _, _, _, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, _, _, _, _, _],
];

// Small bubble - handoff (arrow)
export const BUBBLE_HANDOFF: SpriteData = [
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, K, F, F, F, F, F, F, F, K, _],
  [K, F, F, F, F, B, F, F, F, F, K],
  [K, F, F, F, F, B, B, F, F, F, K],
  [K, F, B, B, B, B, B, B, F, F, K],
  [K, F, F, F, F, B, B, F, F, F, K],
  [K, F, F, F, F, B, F, F, F, F, K],
  [_, K, F, F, F, F, F, F, F, K, _],
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, _, _, _, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, _, _, _, _, _],
];

// Small bubble - error
export const BUBBLE_ERROR: SpriteData = [
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, K, F, F, F, F, F, F, F, K, _],
  [K, F, F, R, F, F, F, R, F, F, K],
  [K, F, F, F, R, F, R, F, F, F, K],
  [K, F, F, F, F, R, F, F, F, F, K],
  [K, F, F, F, R, F, R, F, F, F, K],
  [K, F, F, R, F, F, F, R, F, F, K],
  [_, K, F, F, F, F, F, F, F, K, _],
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, _, _, _, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, _, _, _, _, _],
];

// Alert bubble (exclamation)
export const BUBBLE_ALERT: SpriteData = [
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, K, F, F, F, F, F, F, F, K, _],
  [K, F, F, F, F, A, F, F, F, F, K],
  [K, F, F, F, F, A, F, F, F, F, K],
  [K, F, F, F, F, A, F, F, F, F, K],
  [K, F, F, F, F, F, F, F, F, F, K],
  [K, F, F, F, F, A, F, F, F, F, K],
  [_, K, F, F, F, F, F, F, F, K, _],
  [_, _, K, K, K, K, K, K, K, _, _],
  [_, _, _, _, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, _, _, _, _, _],
];

export const BUBBLE_SPRITES = {
  processing: BUBBLE_PROCESSING,
  done: BUBBLE_DONE,
  handoff: BUBBLE_HANDOFF,
  error: BUBBLE_ERROR,
  alert: BUBBLE_ALERT,
  chat: BUBBLE_PROCESSING, // fallback
} as const;
