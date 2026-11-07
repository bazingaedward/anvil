import type { ReviewCommit } from "../shared/api";
export type GraphEdge = {
  from: number;
  to: number;
  color: number;
  start: boolean;
};
export function graphRows(commits: ReviewCommit[]) {
  let lanes: { hash: string; color: number }[] = [];
  let nextColor = 0;
  return commits.map((commit) => {
    let column = lanes.findIndex((lane) => lane.hash === commit.hash);
    const incoming = column >= 0;
    if (column < 0) {
      column = lanes.length;
      lanes.push({ hash: commit.hash, color: nextColor++ });
    }
    const before = [...lanes];
    const color = before[column].color;
    lanes.splice(column, 1);
    commit.parents.forEach((hash, index) => {
      if (!lanes.some((lane) => lane.hash === hash))
        lanes.splice(Math.min(column + index, lanes.length), 0, {
          hash,
          color: index === 0 ? color : nextColor++,
        });
    });
    const edges: GraphEdge[] = [];
    before.forEach((lane, from) => {
      if (from !== column)
        edges.push({
          from,
          to: lanes.findIndex((next) => next.hash === lane.hash),
          color: lane.color,
          start: false,
        });
    });
    commit.parents.forEach((hash) => {
      const to = lanes.findIndex((lane) => lane.hash === hash);
      edges.push({ from: column, to, color: lanes[to].color, start: true });
    });
    return {
      commit,
      column,
      color,
      edges,
      incoming,
      width: Math.max(before.length, lanes.length),
    };
  });
}
