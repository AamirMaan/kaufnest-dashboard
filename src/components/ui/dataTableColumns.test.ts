import { isTableExpandable, pruneIds, splitColumns, toggleId, totalColSpan } from "./dataTableColumns";

describe("splitColumns", () => {
  it("keeps order and splits on the detail flag", () => {
    const cols = [{ header: "A" }, { header: "B", detail: true }, { header: "C", detail: false }, { header: "D", detail: true }];
    const { inline, detail } = splitColumns(cols);
    expect(inline.map((c) => c.header)).toEqual(["A", "C"]);
    expect(detail.map((c) => c.header)).toEqual(["B", "D"]);
  });

  it("puts everything inline when nothing is flagged", () => {
    const cols: { header: string; detail?: boolean }[] = [{ header: "A" }, { header: "B" }];
    expect(splitColumns(cols)).toEqual({ inline: cols, detail: [] });
  });
});

describe("isTableExpandable", () => {
  it("is false with no detail columns and no renderExpanded", () => {
    expect(isTableExpandable([{}, { detail: false }], false)).toBe(false);
  });

  it("is true with a detail column", () => {
    expect(isTableExpandable([{}, { detail: true }], false)).toBe(true);
  });

  it("is true with renderExpanded alone", () => {
    expect(isTableExpandable([{}], true)).toBe(true);
  });
});

describe("toggleId", () => {
  it("adds a missing id without mutating the input", () => {
    const before = new Set(["a"]);
    const after = toggleId(before, "b");
    expect([...after].sort()).toEqual(["a", "b"]);
    expect([...before]).toEqual(["a"]);
    expect(after).not.toBe(before);
  });

  it("removes a present id", () => {
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
});

describe("pruneIds", () => {
  it("drops ids that are no longer present", () => {
    expect([...pruneIds(new Set(["a", "b", "c"]), ["b", "x"])]).toEqual(["b"]);
  });

  it("returns the same instance when nothing is removed", () => {
    const ids = new Set(["a"]);
    expect(pruneIds(ids, ["a", "b"])).toBe(ids);
  });
});

describe("totalColSpan", () => {
  it.each([
    [{ selectable: false, expandable: false, inlineCount: 5 }, 5],
    [{ selectable: true, expandable: false, inlineCount: 5 }, 6],
    [{ selectable: false, expandable: true, inlineCount: 5 }, 6],
    [{ selectable: true, expandable: true, inlineCount: 5 }, 7],
  ])("%o → %i", (opts, expected) => {
    expect(totalColSpan(opts)).toBe(expected);
  });
});
