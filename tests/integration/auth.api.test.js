"use strict";

const request = require("supertest");
const { buildTestApp } = require("../helpers/testApp");

describe("auth API", () => {
  let app;
  beforeEach(() => {
    app = buildTestApp().app;
  });

  const valid = { email: "jason@example.com", password: "a-good-password", name: "Jason" };

  test("registers a new student", async () => {
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(valid.email);
    expect(res.body.role).toBe("student");
    expect(res.body.passwordHash).toBeUndefined();
  });

  test("rejects registration with missing fields", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  test("rejects a password that is too short", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, password: "short" });
    expect(res.status).toBe(400);
  });

  test("rejects an invalid role", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, role: "admin" });
    expect(res.status).toBe(400);
  });

  test("rejects a duplicate email", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(409);
  });

  test("logs in and returns a token", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: valid.email, password: valid.password });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });

  test("does not reveal whether an email exists", async () => {
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever-password" });
    await request(app).post("/api/auth/register").send(valid);
    const wrongPass = await request(app)
      .post("/api/auth/login")
      .send({ email: valid.email, password: "wrong-password-here" });
    expect(unknown.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(unknown.body).toEqual(wrongPass.body);
  });

  test("/api/auth/me requires a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("/api/auth/me returns the caller", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: valid.email, password: valid.password });
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer " + login.body.token);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(valid.email);
  });

  test("rejects a malformed authorization header", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", "Basic abc");
    expect(res.status).toBe(401);
  });
});
