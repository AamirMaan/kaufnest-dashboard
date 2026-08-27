import { avatarClassesFor, avatarInitial } from "./avatarColor";

describe("avatarClassesFor", () => {
  it("is deterministic — the same username always gets the same classes", () => {
    expect(avatarClassesFor("Sarah_buyer99")).toBe(avatarClassesFor("Sarah_buyer99"));
  });

  it("returns a full static Tailwind class string, never an interpolated one Tailwind's JIT scanner can't see", () => {
    // Every possible return value must be a literal, statically-scannable
    // class string (e.g. "bg-(--color-avatar-3) text-(--color-avatar-3-text)").
    // A template-string-built class name (`bg-(--color-avatar-${n})`) is
    // invisible to Tailwind's build-time scanner and silently generates no CSS.
    const usernames = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "buyer1", "buyer2"];
    for (const username of usernames) {
      expect(avatarClassesFor(username)).toMatch(
        /^bg-\(--color-avatar-[1-6]\) text-\(--color-avatar-[1-6]-text\)$/
      );
    }
  });

  it("distributes different usernames across more than one color", () => {
    const usernames = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"];
    const distinctClasses = new Set(usernames.map(avatarClassesFor));
    expect(distinctClasses.size).toBeGreaterThan(1);
  });

  it("does not crash on an empty string", () => {
    expect(() => avatarClassesFor("")).not.toThrow();
  });
});

describe("avatarInitial", () => {
  it("returns the uppercased first character", () => {
    expect(avatarInitial("sarah_buyer99")).toBe("S");
  });

  it("falls back to ? for an empty or whitespace-only string", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
  });

  it("trims leading whitespace before taking the first character", () => {
    expect(avatarInitial("  sarah")).toBe("S");
  });
});
