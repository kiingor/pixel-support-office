import { TileType } from '../types/office';
import type { Position } from '../types/office';

export function isWalkable(
  col: number,
  row: number,
  tiles: TileType[][],
  blockedTiles: Set<string>,
): boolean {
  if (row < 0 || row >= tiles.length) return false;
  if (col < 0 || col >= tiles[0].length) return false;
  const tile = tiles[row][col];
  if (tile === TileType.WALL || tile === TileType.VOID) return false;
  if (blockedTiles.has(`${col},${row}`)) return false;
  return true;
}

/** BFS shortest path. Returns array of positions from start (exclusive) to end (inclusive). */
export function findPath(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  tiles: TileType[][],
  blockedTiles: Set<string>,
): Position[] {
  if (fromCol === toCol && fromRow === toRow) return [];

  const key = (c: number, r: number) => `${c},${r}`;
  const visited = new Set<string>();
  const parent = new Map<string, string>();

  const queue: Position[] = [{ col: fromCol, row: fromRow }];
  visited.add(key(fromCol, fromRow));

  const dirs = [
    { dc: 0, dr: -1 }, // up
    { dc: 0, dr: 1 },  // down
    { dc: -1, dr: 0 }, // left
    { dc: 1, dr: 0 },  // right
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.col === toCol && current.row === toRow) {
      // Reconstruct path
      const path: Position[] = [];
      let k = key(toCol, toRow);
      while (k !== key(fromCol, fromRow)) {
        const [c, r] = k.split(',').map(Number);
        path.unshift({ col: c, row: r });
        k = parent.get(k)!;
      }
      return path;
    }

    for (const { dc, dr } of dirs) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const nk = key(nc, nr);

      if (!visited.has(nk) && isWalkable(nc, nr, tiles, blockedTiles)) {
        visited.add(nk);
        parent.set(nk, key(current.col, current.row));
        queue.push({ col: nc, row: nr });
      }
    }
  }

  return []; // No path found
}

/** Find path to the nearest walkable tile adjacent to a target position. */
export function findPathNear(
  fromCol: number,
  fromRow: number,
  targetCol: number,
  targetRow: number,
  tiles: TileType[][],
  blockedTiles: Set<string>,
): Position[] {
  // Try adjacent tiles to the target
  const adjacents = [
    { col: targetCol, row: targetRow - 1 },
    { col: targetCol, row: targetRow + 1 },
    { col: targetCol - 1, row: targetRow },
    { col: targetCol + 1, row: targetRow },
    { col: targetCol, row: targetRow }, // Try exact position too
  ];

  let bestPath: Position[] = [];
  let bestLen = Infinity;

  for (const adj of adjacents) {
    if (isWalkable(adj.col, adj.row, tiles, blockedTiles)) {
      const path = findPath(fromCol, fromRow, adj.col, adj.row, tiles, blockedTiles);
      if (path.length > 0 && path.length < bestLen) {
        bestPath = path;
        bestLen = path.length;
      }
    }
  }

  return bestPath;
}
