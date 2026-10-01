"use strict";

const request = require("supertest");
const { buildTestApp } = require("../helpers/testApp");

describe("skills and service endpoints", () => {
  let app;
  let token;

  beforeEach(async () => {
    app = buildTestApp().app;
    await request(app).post("/api/auth/register").send({
      email: "s@example.com", password: "a-good-password", name: "S"
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "s@example.com", password: "a-good-password" });
    token = login.body.token;
  });

  test("the skill catalogue is public", async () => {
    const res = await request(app).get("/api/skills/catalogue");
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test("mapping requires authentication", async () => {
    const res = await request(app).post("/api/skills/map").send({ contributions: [] });
    expect(res.status).toBe(401);
  });

  test("maps contributions to skills", async () => {
    const res = await request(app)
      .post("/api/skills/map")
      .set("Authorization", "Bearer " + token)
      .send({ contributions: ["Add JWT auth", "Add jest tests", "Implement endpoint"] });
    expect(res.status).toBe(200);
    expect(res.body.analysed).toBe(3);
    expect(res.body.matches.length).toBeGreaterThan(0);
  });

  test("rejects a non-array payload", async () => {
    const res = await request(app)
      .post("/api/skills/map")
      .set("Authorization", "Bearer " + token)
      .send({ contributions: "not an array" });
    expect(res.status).toBe(400);
  });

  test("rejects an oversized batch", async () => {
    const res = await request(app)
      .post("/api/skills/map")
      .set("Authorization", "Bearer " + token)
      .send({ contributions: new Array(501).fill("test") });
    expect(res.status).toBe(413);
  });

  test("health reports status and counts", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.counts.users).toBe(1);
  });

  test("metrics are exposed in Prometheus format", async () => {
    await request(app).get("/health");
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("skilltrace_http_requests_total");
  });

  test("unknown routes return a json 404", async () => {
    const res = await request(app).get("/no/such/route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not found");
  });

  test("the chaos endpoint is absent unless explicitly enabled", async () => {
    const res = await request(app).get("/debug/boom");
    expect(res.status).toBe(404);
  });
});
