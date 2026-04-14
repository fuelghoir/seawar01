"use client";

import { Cell, CellState } from "./Cell";
import styles from "./Board.module.css";

interface BoardProps {
  cells: CellState[][];
  onCellClick?: (x: number, y: number) => void;
  isInteractive: boolean;
  label: string;
}

const COL_LABELS = ["А", "Б", "В", "Г", "Д", "Е", "Ё", "Ж", "З", "И"];

export function Board({ cells, onCellClick, isInteractive, label }: BoardProps) {
  return (
    <div className={styles.boardWrapper}>
      <h3 className={styles.label}>{label}</h3>
      <div className={styles.board}>
        {/* Header row: corner + column letters */}
        <div className={styles.row}>
          <div className={styles.cornerCell} />
          {COL_LABELS.map((c) => (
            <div key={c} className={styles.headerCell}>{c}</div>
          ))}
        </div>
        {/* Data rows: row number + cells */}
        {cells.map((row, y) => (
          <div key={y} className={styles.row}>
            <div className={styles.rowHeader}>{y + 1}</div>
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
