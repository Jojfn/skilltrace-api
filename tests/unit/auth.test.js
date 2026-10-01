"use strict";

const { hashPassword, verifyPassword, issueToken, verifyToken } = require("../../src/lib/auth");

describe("password hashing", () => {
  test("hashes and verifies a valid password", () => {
    const hash = hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(verifyPassword("correct-horse-battery", hash)).toBe(true);
  });

  test("rejects the wrong password", () => {
    const hash = hashPassword("correct-horse-battery");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  test("refuses to hash a password shorter than 8 characters", () => {
    expect(() => hashPassword("short")).toThrow(/at least 8/);
  });

  test("verification is defensive about non-string input", () => {
    expect(verifyPassword(null, "x")).toBe(false);
    expect(verifyPassword("x", null)).toBe(false);
  });

  test("the same password hashes differently each time (salted)", () => {
    expect(hashPassword("same-password-here")).not.toBe(hashPassword("same-password-here"));
  });
});

describe("tokens", () => {
  const user = { id: "u1", email: "a@b.com", role: "student" };

  test("issues a verifiable token carrying the user claims", () => {
    const claims = verifyToken(issueToken(user));
    expect(claims.sub).toBe("u1");
    expect(claims.email).toBe("a@b.com");
    expect(claims.role).toBe("student");
  });

  test("rejects a tampered token", () => {
    const token = issueToken(user);
    expect(verifyToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  test("rejects rubbish", () => {
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});
