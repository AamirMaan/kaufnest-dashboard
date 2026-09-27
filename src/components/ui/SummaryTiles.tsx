import type { SummaryTile } from "./summaryTileHelpers";

interface SummaryTilesProps {
  tiles: SummaryTile[];
  loading: boolean;
  error: boolean;
  className?: string;
}

const SKELETON_COUNT = 4;

/**
 * Display-only row of compact summary tiles above a data table. Values are
 * built by pure helpers in `./summaryTileHelpers` — this component only lays
 * them out. Deliberately not interactive (no button semantics, no hover).
 */
export function SummaryTiles({ tiles, loading, error, className = "" }: SummaryTilesProps) {
  if (error) {
    return <p className={`text-xs text-(--color-text-muted) ${className}`}>Totals unavailable</p>;
  }

  if (loading && tiles.length === 0) {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`} aria-busy="true" aria-label="Loading totals">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div
            key={i}
            className="h-[52px] w-28 animate-pulse rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface)"
          />
        ))}
      </div>
    );
  }

  return (
    <dl
      className={`flex flex-wrap gap-2 transition-opacity ${loading ? "opacity-60" : ""} ${className}`}
      aria-busy={loading}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="min-w-24 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-3 py-2"
        >
          <dt className="text-[11px] font-medium text-(--color-text-muted)">{tile.label}</dt>
          {tile.lines.map((line, i) => (
            <dd key={i} className="text-sm font-semibold text-(--color-text-strong) tabular-nums">
              {line}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}
