"use client";

import { Cell, CellState } from "./Cell";
import { useSettings } from "../lib/settings";
import styles from "./Board.module.css";

interface BoardProps {
  cells: CellState[][];
  onCellClick?: (x: number, y: number) => void;
  isInteractive: boolean;
  label: string;
}

const COL_LABELS_RU = ["А", "Б", "В", "Г", "Д", "Е", "Ё", "Ж", "З", "И"];
const COL_LABELS_EN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export function Board({ cells, onCellClick, isInteractive, label }: BoardProps) {
  const { lang } = useSettings();
  const COL_LABELS = lang === "ru" ? COL_LABELS_RU : COL_LABELS_EN;

  return (
    <div className={styles.boardWrapper}>
      <h3 className={styles.label}>{label}</h3>
      <div className={styles.frame}>
        <div className={styles.colHeader}>
          {COL_LABELS.map((c, i) => (
            <div key={i} className={styles.headerCell}>{c}</div>
          ))}
        </div>

        <div className={styles.body}>
          <div className={styles.rowLabels}>
            {cells.map((_, y) => (
              <div key={y} className={styles.rowHeader}>{y + 1}</div>
            ))}
          </div>

          <div className={styles.board}>
            {cells.map((row, y) => (
              <div key={y} className={styles.row}>
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
      </div>
    </div>
  );
}
