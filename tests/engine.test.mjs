import test from "node:test";
import assert from "node:assert/strict";
import {
  companies,
  activeCompanies,
  equity,
  approve,
  advance,
  risk,
  requestExit,
  validateState,
  backtest,
  strategies,
  krwBars,
  fxOf,
  INITIAL,
  FEE,
  SLIP,
} from "../web/engine.mjs";
import {readyState as createState} from './fixtures.mjs';
test("three markets have coherent native OHLC and reproducible datasets", () => {
  const a = createState(),
    b = createState();
  assert.equal(activeCompanies(a).length, 24);
  for (const country of ["한국", "미국", "일본"])
    assert.equal(activeCompanies(a).filter((c) => c.country === country).length, 8);
  assert.deepEqual(a.data, b.data);
  validateState(a);
  for (const c of activeCompanies(a))
    assert.equal(
      krwBars(a, c.symbol).at(-1).close,
      a.data[c.symbol].at(-1).close * fxOf(c.symbol),
    );
  assert.equal(equity(a), INITIAL);
});
test("unapproved plans never trade and expire when the date advances", () => {
  const s = createState();
  const old = s.plans.find((p) => p.status === "대기");
  advance(s);
  assert.equal(s.trades.length, 0);
  assert.equal(s.cash, INITIAL);
  assert.equal(old.status, "만료");
});
test("approval does not fill immediately; next session accounts for fees and slippage", () => {
  const s = createState(),
    p = s.plans.find((p) => p.status === "대기");
  assert.ok(p);
  approve(s, p.id);
  assert.equal(s.trades.length, 0);
  advance(s);
  const t = s.trades.find((t) => t.side === "buy");
  assert.ok(t);
  const close = krwBars(s, p.symbol).at(-1).close;
  assert.equal(t.price, close * (1 + SLIP));
  assert.equal(t.fee, t.qty * t.price * FEE);
  const holdingsValue = s.holdings.reduce(
    (a, h) => a + h.qty * krwBars(s, h.symbol).at(-1).close,
    0,
  );
  assert.ok(Math.abs(equity(s) - s.cash - holdingsValue) < 1e-6);
  assert.throws(() => approve(s, p.id));
});
test("approved orders reserve cash and sector capacity", () => {
  const s = createState(),
    p = s.plans.find((p) => p.status === "대기");
  p.qty = Math.floor((INITIAL * 0.195) / p.reference);
  p.stop = p.reference * 0.98;
  assert.equal(risk(s, p).pass, true);
  approve(s, p.id);
  const second = { ...p, id: "P999", qty: p.qty, status: "대기" };
  assert.equal(risk(s, second).pass, false);
  assert.ok(
    risk(s, second).checks.some(([n, b]) => n === "종목 비중 20% 이하" && !b),
  );
});
test("a gap from the reference price no longer holds an approved entry", () => {
  const s = createState(),
    p = s.plans.find((p) => p.status === "대기");
  approve(s, p.id);
  p.reference *= 0.5;
  advance(s);
  assert.equal(p.status, "체결");
  assert.equal(s.trades.length, 1);
  assert.ok(!p.riskReview.checks.some(([n]) => n.includes("3%")));
});
test("full simulation preserves cash and valid states over 30 days", () => {
  const s = createState();
  for (let i = 0; i < 30; i++) {
    for (const p of s.plans.filter((p) => p.status === "대기"))
      try {
        approve(s, p.id);
      } catch {}
    advance(s);
    assert.ok(s.cash >= 0);
    assert.ok(Number.isFinite(equity(s)));
    validateState(s);
  }
  assert.ok(s.trades.length > 0);
});
test("sell request remains pending and backup validation rejects corrupt data", () => {
  const s = createState();
  approve(s, s.plans.find((p) => p.status === "대기").id);
  advance(s);
  assert.ok(s.holdings.length);
  const h = s.holdings[0];
  requestExit(s, h.symbol);
  const p = s.plans.at(-1);
  assert.equal(p.side, "sell");
  assert.equal(p.status, "대기");
  assert.equal(s.holdings.length, 1);
  const bad = structuredClone(s);
  bad.data.AAPL.at(-1).close = NaN;
  assert.throws(() => validateState(bad));
  const bad2 = structuredClone(s);
  bad2.cash = -1;
  assert.throws(() => validateState(bad2));
});
test("backtest decisions do not read future data", () => {
  const s = createState(),
    bars = krwBars(s, "005930"),
    st = strategies[0],
    original = backtest(bars, st),
    changed = structuredClone(bars);
  for (let i = 240; i < changed.length; i++)
    for (const k of ["open", "close", "high", "low"]) changed[i][k] *= 2;
  const other = backtest(changed, st);
  assert.deepEqual(original.points.slice(0, 60), other.points.slice(0, 60));
  assert.equal(strategies.length, 60);
});

test("foreign currency positions sell in won and never use native units in the ledger", () => {
  const s = createState(),
    p = s.plans.find(
      (p) =>
        p.status === "대기" &&
        companies.find((c) => c.symbol === p.symbol).country === "미국",
    );
  assert.ok(p);
  approve(s, p.id);
  advance(s);
  const h = s.holdings.find((h) => h.symbol === p.symbol);
  assert.ok(h);
  requestExit(s, h.symbol);
  const exit = s.plans.at(-1);
  assert.equal(exit.reference, krwBars(s, h.symbol).at(-1).close);
  approve(s, exit.id);
  advance(s);
  assert.ok(s.trades.some((t) => t.side === "sell" && t.symbol === p.symbol));
  assert.ok(s.cash > INITIAL * 0.8);
  validateState(s);
});
