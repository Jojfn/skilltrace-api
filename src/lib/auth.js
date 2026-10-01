"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");

const ROUNDS = 10;

function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
  return bcrypt.hashSync(plain, ROUNDS);
}

function verifyPassword(plain, hash) {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  return bcrypt.compareSync(plain, hash);
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.tokenTtl, algorithm: "HS256" }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch (err) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken };
