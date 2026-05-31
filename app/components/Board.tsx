"use client";

import { Cell, CellState } from "./Cell";
import { useSettings } from "../lib/settings";
import styles from "./Board.module.css";

interface BoardProps {
  cells: CellState[][];
  onCellClick?: (x: number, y: number) => void;
  isInteractive: boolean;
  label: string;
  variant?: "target" | "fleet" | "placement";
}

const COL_LABELS_RU = ["А", "Б", "В", "Г", "Д", "Е", "Ё", "Ж", "З", "И"];
const COL_LABELS_EN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export function Board({ cells, onCellClick, isInteractive, label, variant }: BoardProps) {
  const { lang } = useSettings();
  const COL_LABELS = lang === "ru" ? COL_LABELS_RU : COL_LABELS_EN;
  const boardVariant = variant ?? "fleet";
  const kicker =
    boardVariant === "target"
      ? "TARGET GRID"
      : boardVariant === "placement"
        ? "DEPLOYMENT GRID"
        : "FLEET GRID";

  return (
    <section className={`${styles.boardWrapper} ${styles[`${boardVariant}Board`]}`}>
      <div className={styles.boardHeading}>
        <div>
          <span className={styles.kicker}>{kicker}</span>
          <h3 className={styles.label}>{label}</h3>
        </div>
        <span className={styles.gridCode}>10 x 10</span>
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
                    label={`${COL_LABELS[x]}${y + 1}`}
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
