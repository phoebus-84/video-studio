// ---------------------------------------------------------------------------
// Principal resolution (avg-qr4.3)
// ---------------------------------------------------------------------------
// Two credentials now authenticate a request: the gateway token (the agent's,
// including Pi) and the operator key (the browser and the CLI). Only a review
// decision and an attended claim look at which one matched — everything else
// in the request pipeline is unchanged by this.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createAuthMiddleware } from "../src/auth/middleware.js";

async function app(allowDev = false) {
  const a = Fastify();
  const mw = createAuthMiddleware("agent-token", "operator-key", allowDev);
  a.addHook("preHandler", mw);
  a.get("/who", async (req) => ({ principal: req.principal }));
  return a;
}

const who = async (auth: string, allowDev = false) =>
  (await (await app(allowDev)).inject({ url: "/who", headers: { authorization: auth } }));

describe("principal", () => {
  it("operator key → operator", async () =>
    expect((await who("Bearer operator-key")).json().principal).toBe("operator"));

  it("agent token → agent", async () =>
    expect((await who("Bearer agent-token")).json().principal).toBe("agent"));

  it("dev-token is never an operator", async () =>
    expect((await who("Bearer dev-token", true)).json().principal).toBe("agent"));

  it("anything else is 401", async () =>
    expect((await who("Bearer nope")).statusCode).toBe(401));

  it("refuses an operator key equal to the agent token: the two would be indistinguishable", () =>
    expect(() => createAuthMiddleware("same", "same")).toThrow(/distinct/));
});
