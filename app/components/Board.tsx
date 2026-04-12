"use client";

import { Cell, CellState } from "./Cell";
import styles from "./Board.module.css";

interface BoardProps {
  cells: CellState[][];
  onCellClick?: (x: number, y: number) => void;
  isInteractive: boolean;
  label: string;
}

const COL_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export function Board({ cells, onCellClick, isInteractive, label }: BoardProps) {
  return (
    <div className={styles.boardWrapper}>
      <h3 className={styles.label}>{label}</h3>
      <div className={styles.board}>
        {/* Corner */}
        <div className={styles.cornerCell} />
        {/* Column headers */}
        {COL_LABELS.map((c) => (
          <div key={c} className={styles.headerCell}>{c}</div>
        ))}
        {/* Rows */}
        {cells.map((row, y) => (
          <div key={y} className={styles.row}>
            <div className={styles.headerCell}>{y + 1}</div>
            {row.map((cellState, x) => (
              <Cell
                key={`${x}-${y}`}
                state={cellState}
                onClick={() => onCellClick?.(x, y)}
                isInteractive={isInteractive}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
