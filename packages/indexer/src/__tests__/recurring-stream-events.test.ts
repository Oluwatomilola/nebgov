import { nativeToScVal, SorobanRpc, xdr } from "@stellar/stellar-sdk";
import { processEvents } from "../events";
import { pool } from "../db";
import { broadcast } from "../ws";
import { invalidatePattern } from "../cache";

jest.mock("../db", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../cache", () => ({
  invalidate: jest.fn(),
  invalidatePattern: jest.fn(),
}));

jest.mock("../ws", () => ({
  broadcast: jest.fn(),
}));

const GOVERNOR = "CGOVERNOR";
const STREAMS = "CSTREAMS";

function makeEvent(
  id: string,
  ledger: number,
  eventType: string,
  value: unknown,
  contractId = STREAMS,
): SorobanRpc.Api.EventResponse {
  return {
    id,
    type: "contract",
    ledger,
    contractId,
    txHash: `tx-${ledger}`,
    topic: [
      nativeToScVal(eventType, { type: "symbol" }),
      nativeToScVal(1n, { type: "u64" }),
    ],
    value: value === null ? xdr.ScVal.scvVoid() : nativeToScVal(value),
  } as unknown as SorobanRpc.Api.EventResponse;
}

describe("recurring treasury stream event indexing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockImplementation((sql: string) =>
      String(sql).includes("INSERT INTO recurring_stream_executions")
        ? { rows: [{ event_id: "execution-1" }], rowCount: 1 }
        : { rows: [], rowCount: null },
    );
  });

  it("indexes creation, execution and lifecycle events from the configured contract", async () => {
    const events = [
      makeEvent("created-1", 100, "StrmCreated", {
        recipient: "GRECIPIENT",
        amount_per_interval: 100n,
        interval_ledgers: 5,
      }),
      makeEvent("execution-1", 105, "StrmExec", {
        stream_id: 1n,
        amount: 100n,
        executed_at_ledger: 105,
      }),
      makeEvent("paused-1", 106, "StrmPaused", null),
      makeEvent("resumed-1", 107, "StrmResumed", null),
      makeEvent("cancelled-1", 108, "StrmCancel", {
        stream_id: 1n,
        total_streamed: 100n,
      }),
    ];
    const server = {
      getEvents: jest.fn().mockResolvedValue({ events }),
    } as unknown as SorobanRpc.Server;

    await processEvents(
      server,
      {
        rpcUrl: "http://fake",
        governorAddress: GOVERNOR,
        treasuryStreamsContractAddress: STREAMS,
        pollIntervalMs: 1,
      },
      100,
    );

    expect(server.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ type: "contract", contractIds: [GOVERNOR, STREAMS] }],
      }),
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO recurring_streams"),
      ["1", "GRECIPIENT", "100", 5, 100],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO recurring_stream_executions"),
      ["execution-1", "1", "100", 105, 105, "tx-105"],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("execution_count = execution_count + 1"),
      ["1", "100", 105],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("cancelled = TRUE"),
      ["1", "100", 108],
    );
    expect(broadcast).toHaveBeenCalledTimes(5);
    expect(invalidatePattern).toHaveBeenCalledTimes(5);
  });

  it("does not index matching topics from a different contract", async () => {
    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [
          makeEvent(
            "other-contract",
            200,
            "StrmCreated",
            {
              recipient: "GRECIPIENT",
              amount_per_interval: 100n,
              interval_ledgers: 5,
            },
            GOVERNOR,
          ),
        ],
      }),
    } as unknown as SorobanRpc.Server;

    await processEvents(
      server,
      {
        rpcUrl: "http://fake",
        governorAddress: GOVERNOR,
        treasuryStreamsContractAddress: STREAMS,
        pollIntervalMs: 1,
      },
      200,
    );

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO recurring_streams"),
      expect.anything(),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});
