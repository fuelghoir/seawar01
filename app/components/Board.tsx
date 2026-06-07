"use client";

import type { CSSProperties } from "react";
import { Cell, CellState } from "./Cell";
import { useSettings } from "../lib/settings";
import styles from "./Board.module.css";

interface BoardProps {
  cells: CellState[][];
  onCellClick?: (x: number, y: number) => void;
  isInteractive: boolean;
  label: string;
  variant?: "target" | "fleet" | "placement";
  cellSize?: string;
}

const COL_LABELS_EN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export function Board({ cells, onCellClick, isInteractive, label, variant, cellSize }: BoardProps) {
  const { lang } = useSettings();
  const rowCount = cells.length;
  const colCount = cells.reduce((max, row) => Math.max(max, row.length), 0);
  const COL_LABELS = COL_LABELS_EN.slice(0, colCount);
  const boardVariant = variant ?? "fleet";
  const wrapperStyle = cellSize ? ({ "--cell": cellSize } as CSSProperties) : undefined;
  const kicker =
    boardVariant === "target"
      ? lang === "ru" ? "СЕТКА ЦЕЛИ" : "TARGET GRID"
      : boardVariant === "placement"
        ? lang === "ru" ? "РАССТАНОВКА" : "DEPLOYMENT GRID"
        : lang === "ru" ? "СЕТКА ФЛОТА" : "FLEET GRID";

  return (
    <section
      className={`${styles.boardWrapper} ${styles[`${boardVariant}Board`]}`}
      style={wrapperStyle}
    >
      <div className={styles.boardHeading}>
        <div>
          <span className={styles.kicker}>{kicker}</span>
          <h3 className={styles.label}>{label}</h3>
        </div>
        <span className={styles.gridCode}>{colCount} x {rowCount}</span>
      </div>
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
                    label={`${COL_LABELS[x] ?? x + 1}${y + 1}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
