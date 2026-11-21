import request from "supertest";
import { createApp } from "../api";
import { pool } from "../db";

jest.mock("../db", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../cache", () => ({
  cached: jest.fn((_key, _ttl, fn) => fn()),
  getMetrics: jest.fn(() => ({ hits: 0, misses: 0, size: 0 })),
}));

jest.mock("../events", () => ({
  getLastIndexedLedger: jest.fn().mockResolvedValue(100),
}));

jest.mock("../index", () => ({
  startTime: Date.now(),
  INDEXED_CONTRACTS: {},
}));

const app = createApp({
  getLatestLedger: jest.fn().mockResolvedValue({ sequence: 100 }),
} as any);
const query = pool.query as jest.Mock;

describe("recurring treasury stream API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists recurring streams with pagination", async () => {
    const rows = [{ stream_id: "2", recipient: "GRECIPIENT" }];
    query.mockResolvedValueOnce({ rows });

    const response = await request(app).get("/recurring-streams?limit=10&offset=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      pagination: { limit: 10, offset: 2, hasMore: false },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM recurring_streams"),
      [10, 2],
    );
  });

  it("lists a stream's executions with pagination and validates its ID", async () => {
    const rows = [{ event_id: "event-1", amount: "10" }];
    query
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows });

    const response = await request(app).get(
      "/recurring-streams/1/executions?limit=5&offset=1",
    );
    const invalid = await request(app).get("/recurring-streams/nope/executions");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      pagination: { limit: 5, offset: 1, hasMore: false },
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("ORDER BY executed_at_ledger DESC"),
      ["1", 5, 1],
    );
    expect(invalid.status).toBe(400);
  });

  it("returns 404 when an execution history stream does not exist", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get("/recurring-streams/99/executions");

    expect(response.status).toBe(404);
  });
});
