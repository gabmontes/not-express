"use strict";

const { test } = require("node:test");
const assert = require("assert");

const cors = require("../src/cors");

test("Response headers are set correctly", function () {
  const options = {
    methods: ["GET", "POST"],
    origin: ["http://example.com"],
  };
  const middleware = cors(options);

  const req = {
    headers: {
      "access-control-request-headers": "Authorization",
      origin: "http://example.com",
    },
  };
  const res = {
    setHeader: function (name, value) {
      this[name] = value;
    },
  };
  const next = function () {};

  // @ts-expect-error: `req` is obviously not a `http.IncomingMessage`
  middleware(req, res, next);

  assert.strictEqual(res["Access-Control-Allow-Headers"], "Authorization");
  assert.strictEqual(res["Access-Control-Allow-Methods"], "GET,POST");
  assert.strictEqual(res["Access-Control-Allow-Origin"], "http://example.com");
});

test("Use default methods and disallow origin", function () {
  const options = {
    origin: ["http://example.com"],
  };
  const middleware = cors(options);

  const req = {
    headers: {
      origin: "http://example.org",
    },
  };
  const res = {
    setHeader: function (name, value) {
      this[name] = value;
    },
  };
  const next = function () {};

  // @ts-expect-error: `req` is obviously not a `http.IncomingMessage`
  middleware(req, res, next);

  assert.strictEqual(res["Access-Control-Allow-Methods"], "GET");
  assert.strictEqual(res["Access-Control-Allow-Origin"], undefined);
});
