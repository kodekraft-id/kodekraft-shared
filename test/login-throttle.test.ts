// Kebijakan penundaan tebakan password (doc 33 §5.3, BE-mono-46): murni, jadi diuji dengan jam manual.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LOGIN_DELAY_TIERS,
  LOGIN_FAILURE_WINDOW_MINUTES,
  loginDelaySeconds,
  loginKeyMaterial,
  loginRetryAfterSeconds,
  loginThrottleMessage,
} from "../src/login-throttle.js";

const T0 = new Date("2026-10-06T10:00:00.000Z");
const plus = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("loginDelaySeconds", () => {
  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 30],
    [6, 30],
    [9, 30],
    [10, 300],
    [11, 300],
    [500, 300],
  ])("%i kegagalan => %i detik", (failures, seconds) => {
    expect(loginDelaySeconds(failures)).toBe(seconds);
  });

  it.each([-3, NaN, Infinity, -Infinity, 0.5])("masukan tak masuk akal %s => 0 (tidak pernah melempar)", (value) => {
    expect(loginDelaySeconds(value as number)).toBe(0);
  });

  it("tabel ambang menurun dan membeku", () => {
    expect(Object.isFrozen(LOGIN_DELAY_TIERS)).toBe(true);
    const failures = LOGIN_DELAY_TIERS.map((tier) => tier.failures);
    expect(failures).toEqual([...failures].sort((a, b) => b - a));
    expect(LOGIN_FAILURE_WINDOW_MINUTES).toBe(15);
  });
});

describe("loginRetryAfterSeconds", () => {
  it("di bawah 5 kegagalan: boleh mencoba sekarang", () => {
    expect(loginRetryAfterSeconds({ failures: 4, lastFailedAt: T0.toISOString() }, T0)).toBe(0);
  });

  it("kegagalan ke-5: menunggu 30 detik sejak kegagalan terakhir, lalu boleh lagi", () => {
    const state = { failures: 5, lastFailedAt: T0.toISOString() };
    expect(loginRetryAfterSeconds(state, T0)).toBe(30);
    expect(loginRetryAfterSeconds(state, plus(10))).toBe(20);
    expect(loginRetryAfterSeconds(state, plus(29.2))).toBe(1);
    expect(loginRetryAfterSeconds(state, plus(30))).toBe(0);
    expect(loginRetryAfterSeconds(state, plus(3600))).toBe(0);
  });

  it("kegagalan ke-10: menunggu 5 menit", () => {
    const state = { failures: 10, lastFailedAt: T0.toISOString() };
    expect(loginRetryAfterSeconds(state, T0)).toBe(300);
    expect(loginRetryAfterSeconds(state, plus(299))).toBe(1);
    expect(loginRetryAfterSeconds(state, plus(300))).toBe(0);
  });

  it("waktu kegagalan terakhir menerima Date, ISO, dan format SQLite", () => {
    expect(loginRetryAfterSeconds({ failures: 5, lastFailedAt: T0 }, T0)).toBe(30);
    expect(loginRetryAfterSeconds({ failures: 5, lastFailedAt: "2026-10-06 10:00:00" }, T0)).toBe(30);
  });

  it.each([null, undefined, "", "bukan tanggal"])("waktu terakhir %s tak terbaca => tidak ada penundaan (jangan mengunci pemilik)", (lastFailedAt) => {
    expect(loginRetryAfterSeconds({ failures: 50, lastFailedAt: lastFailedAt as string }, T0)).toBe(0);
  });

  it("jam yang mundur dari kegagalan terakhir tidak menghasilkan penundaan lebih lama dari ambangnya", () => {
    const state = { failures: 5, lastFailedAt: plus(5).toISOString() };
    expect(loginRetryAfterSeconds(state, T0)).toBe(35); // 5 detik "di masa depan" + 30
  });
});

describe("loginKeyMaterial", () => {
  it("email dinormalkan: huruf besar dan spasi di ujung tidak membuat akun baru", () => {
    expect(loginKeyMaterial("client", "account", "  Budi@Contoh.ID ")).toBe("client|account|budi@contoh.id");
  });

  it("scope dan jenis kunci ikut: akun pelanggan dan akun admin berbeda, akun dan IP berbeda", () => {
    const keys = new Set([
      loginKeyMaterial("client", "account", "a@b.id"),
      loginKeyMaterial("admin", "account", "a@b.id"),
      loginKeyMaterial("client", "ip", "a@b.id"),
    ]);
    expect(keys.size).toBe(3);
  });

  it("alamat IPv6 dinormalkan ke huruf kecil", () => {
    expect(loginKeyMaterial("admin", "ip", "2001:DB8::1")).toBe("admin|ip|2001:db8::1");
  });
});

describe("loginThrottleMessage", () => {
  it("menyebut detik di bawah dua menit dan menit di atasnya, dibulatkan ke atas, minimal 1", () => {
    expect(loginThrottleMessage(30)).toBe("Terlalu banyak percobaan. Coba lagi dalam 30 detik.");
    expect(loginThrottleMessage(0)).toBe("Terlalu banyak percobaan. Coba lagi dalam 1 detik.");
    expect(loginThrottleMessage(0.2)).toBe("Terlalu banyak percobaan. Coba lagi dalam 1 detik.");
    expect(loginThrottleMessage(300)).toBe("Terlalu banyak percobaan. Coba lagi dalam 5 menit.");
    expect(loginThrottleMessage(NaN)).toBe("Terlalu banyak percobaan. Coba lagi dalam 1 detik.");
  });
});

describe("tabel login_failures di matriks kepemilikan (migrasi 0037)", () => {
  const ownership = JSON.parse(readFileSync(fileURLToPath(new URL("../ownership.json", import.meta.url)), "utf8"));
  const sql = readFileSync(fileURLToPath(new URL("../migrations.lock.json", import.meta.url)), "utf8");

  it("hanya worker-user dan worker-admin yang menulis, tanpa pembaca lain", () => {
    const table = ownership.tables.login_failures;
    expect(Object.keys(table.writers).sort()).toEqual(["worker-admin", "worker-user"]);
    expect(table.writers["worker-user"]).toBe("*");
    expect(table.writers["worker-admin"]).toBe("*");
    expect(table.readers).toEqual([]);
  });

  it("migrasi 0037 tercatat di migrations.lock.json", () => {
    expect(sql).toContain("0037_login_failures.sql");
  });
});
