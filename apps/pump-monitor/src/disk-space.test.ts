import { describe, expect, it } from "vitest";
import {
  formatBytes,
  pickProbePath,
  readDiskSpace,
  summarizeStatfs,
} from "./disk-space.js";

describe("formatBytes", () => {
  it("renders bytes below a kibibyte verbatim", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("renders one decimal below ten units", () => {
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(9.94 * 1024 ** 3)).toBe("9.9 GB");
  });

  it("drops the decimal at ten units and above", () => {
    expect(formatBytes(12.7 * 1024 ** 2)).toBe("13 MB");
    expect(formatBytes(412 * 1024 ** 3)).toBe("412 GB");
  });

  it("scales up to terabytes", () => {
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
  });
});

describe("summarizeStatfs", () => {
  it("reports free space from blocks available to unprivileged users", () => {
    const summary = summarizeStatfs({
      bsize: 4_096,
      blocks: 1_000,
      bfree: 400,
      bavail: 300,
    });

    expect(summary.freeBytes).toBe(300 * 4_096);
    expect(summary.totalBytes).toBe(1_000 * 4_096);
  });

  it("computes used percent the way df does, excluding reserved blocks", () => {
    const summary = summarizeStatfs({
      bsize: 1_024,
      blocks: 1_000,
      bfree: 400,
      bavail: 300,
    });

    expect(summary.usedPercent).toBe(67);
  });

  describe("when the filesystem reports no usable blocks", () => {
    it("reports zero used percent rather than dividing by zero", () => {
      const summary = summarizeStatfs({
        bsize: 4_096,
        blocks: 0,
        bfree: 0,
        bavail: 0,
      });

      expect(summary.usedPercent).toBe(0);
      expect(Number.isNaN(summary.usedPercent)).toBe(false);
    });
  });
});

describe("pickProbePath", () => {
  it("picks the first candidate that exists", () => {
    const picked = pickProbePath(["/data", "/repo"], (path) => path === "/data");

    expect(picked).toBe("/data");
  });

  describe("when earlier candidates are missing", () => {
    it("falls through to the first one that exists", () => {
      const picked = pickProbePath(["/data", "/repo"], (path) => path === "/repo");

      expect(picked).toBe("/repo");
    });
  });

  describe("when no candidate exists", () => {
    it("falls back to the last candidate", () => {
      const picked = pickProbePath(["/data", "/repo"], () => false);

      expect(picked).toBe("/repo");
    });
  });
});

describe("readDiskSpace", () => {
  it("reports positive capacity for an existing path", async () => {
    const summary = await readDiskSpace(process.cwd());

    expect(summary).not.toBeNull();
    expect(summary!.totalBytes).toBeGreaterThan(0);
    expect(summary!.freeBytes).toBeGreaterThanOrEqual(0);
    expect(summary!.freeBytes).toBeLessThanOrEqual(summary!.totalBytes);
    expect(summary!.usedPercent).toBeGreaterThanOrEqual(0);
    expect(summary!.usedPercent).toBeLessThanOrEqual(100);
  });

  describe("when the path does not exist", () => {
    it("returns null instead of throwing", async () => {
      await expect(
        readDiskSpace("/no/such/path/for/disk/space/test"),
      ).resolves.toBeNull();
    });
  });
});
