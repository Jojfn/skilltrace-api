"use strict";

const request = require("supertest");
const { buildTestApp } = require("../helpers/testApp");

async function registerAndLogin(app, overrides = {}) {
  const user = {
    email: "student@example.com",
    password: "a-good-password",
    name: "Student",
    ...overrides
  };
  await request(app).post("/api/auth/register").send(user);
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: user.password });
  return login.body.token;
}

describe("evidence API", () => {
  let app;
  let studentToken;
  let ownerToken;

  beforeEach(async () => {
    app = buildTestApp().app;
    studentToken = await registerAndLogin(app);
    ownerToken = await registerAndLogin(app, {
      email: "owner@example.com", name: "Owner", role: "owner"
    });
  });

  const draft = { title: "Built the API", skillCode: "PROG", result: "Shipped it" };

  function create(token, body = draft) {
    return request(app)
      .post("/api/evidence")
      .set("Authorization", "Bearer " + token)
      .send(body);
  }

  test("requires authentication", async () => {
    const res = await request(app).post("/api/evidence").send(draft);
    expect(res.status).toBe(401);
  });

  test("creates evidence as a draft", async () => {
    const res = await create(studentToken);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.id).toBeTruthy();
  });

  test("rejects evidence without a title or skill code", async () => {
    const res = await create(studentToken, { title: "no skill code" });
    expect(res.status).toBe(400);
  });

  test("lists only the caller's own evidence", async () => {
    await create(studentToken);
    await create(ownerToken);
    const res = await request(app)
      .get("/api/evidence")
      .set("Authorization", "Bearer " + studentToken);
    expect(res.body.count).toBe(1);
  });

  test("returns 404 for unknown evidence", async () => {
    const res = await request(app)
      .get("/api/evidence/does-not-exist")
      .set("Authorization", "Bearer " + studentToken);
    expect(res.status).toBe(404);
  });

  test("updates a draft", async () => {
    const created = await create(studentToken);
    const res = await request(app)
      .put("/api/evidence/" + created.body.id)
      .set("Authorization", "Bearer " + studentToken)
      .send({ title: "Updated title" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated title");
  });

  test("refuses to update someone else's evidence", async () => {
    const created = await create(studentToken);
    const res = await request(app)
      .put("/api/evidence/" + created.body.id)
      .set("Authorization", "Bearer " + ownerToken)
      .send({ title: "Hijacked" });
    expect(res.status).toBe(403);
  });

  test("deletes own evidence", async () => {
    const created = await create(studentToken);
    const res = await request(app)
      .delete("/api/evidence/" + created.body.id)
      .set("Authorization", "Bearer " + studentToken);
    expect(res.status).toBe(204);
  });

  test("submission requires a result", async () => {
    const created = await create(studentToken, { title: "No result", skillCode: "PROG" });
    const res = await request(app)
      .post("/api/evidence/" + created.body.id + "/submit")
      .set("Authorization", "Bearer " + studentToken);
    expect(res.status).toBe(400);
  });

  test("a student cannot endorse their own evidence", async () => {
    const created = await create(studentToken);
    await request(app)
      .post("/api/evidence/" + created.body.id + "/submit")
      .set("Authorization", "Bearer " + studentToken);
    const res = await request(app)
      .post("/api/evidence/" + created.body.id + "/endorse")
      .set("Authorization", "Bearer " + studentToken);
    expect(res.status).toBe(403);
  });

  test("an owner endorses submitted evidence", async () => {
    const created = await create(studentToken);
    await request(app)
      .post("/api/evidence/" + created.body.id + "/submit")
      .set("Authorization", "Bearer " + studentToken);
    const res = await request(app)
      .post("/api/evidence/" + created.body.id + "/endorse")
      .set("Authorization", "Bearer " + ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("endorsed");
    expect(res.body.endorsedBy).toBe("owner@example.com");
  });

  test("a draft cannot be endorsed before submission", async () => {
    const created = await create(studentToken);
    const res = await request(app)
      .post("/api/evidence/" + created.body.id + "/endorse")
      .set("Authorization", "Bearer " + ownerToken);
    expect(res.status).toBe(409);
  });

  test("endorsed evidence cannot be edited", async () => {
    const created = await create(studentToken);
    await request(app)
      .post("/api/evidence/" + created.body.id + "/submit")
      .set("Authorization", "Bearer " + studentToken);
    await request(app)
      .post("/api/evidence/" + created.body.id + "/endorse")
      .set("Authorization", "Bearer " + ownerToken);
    const res = await request(app)
      .put("/api/evidence/" + created.body.id)
      .set("Authorization", "Bearer " + studentToken)
      .send({ title: "Sneaky edit" });
    expect(res.status).toBe(409);
  });

  test("declining requires a reason", async () => {
    const created = await create(studentToken);
    await request(app)
      .post("/api/evidence/" + created.body.id + "/submit")
      .set("Authorization", "Bearer " + studentToken);
    const res = await request(app)
      .post("/api/evidence/" + created.body.id + "/decline")
      .set("Authorization", "Bearer " + ownerToken)
      .send({});
    expect(res.status).toBe(400);
  });

  test("an owner declines with a reason", async () => {
    const created = await create(studentToken);
    await request(app)
      .post("/api/evidence/" + created.body.id + "/submit")
      .set("Authorization", "Bearer " + studentToken);
    const res = await request(app)
      .post("/api/evidence/" + created.body.id + "/decline")
      .set("Authorization", "Bearer " + ownerToken)
      .send({ reason: "Result is not evidenced" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("declined");
  });
});
