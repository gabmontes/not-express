"use strict";

const { test } = require("node:test");
const assert = require("assert");
const http = require("http");

const express = require("../src/express");
// const express = require("express");

function testRequest(app, method, path, predicate, done) {
  const server = app.listen();
  server.on("listening", function () {
    const { port } = /** @type {import('net').AddressInfo} */ (
      server.address()
    );
    const req = http.request(
      `http://localhost:${port}${path}`,
      { method },
      function (res) {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", function () {
          server.close();
          try {
            predicate(res, data);
            done();
          } catch (err) {
            done(err);
          }
        });
      },
    );
    req.on("error", done);
    req.end();
  });
}

test("Respond 404 if no routes are defined", function (t, done) {
  const app = express();
  testRequest(
    app,
    "GET",
    "/",
    function (res) {
      assert.strictEqual(res.statusCode, 404);
    },
    done,
  );
});

test("Define a simple GET route", function (t, done) {
  const app = express();
  app.get("/", function (req, res) {
    res.end("Hello World!");
  });
  testRequest(
    app,
    "GET",
    "/",
    function (res, data) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(data, "Hello World!");
    },
    done,
  );
});

test("Use path parameters", function (t, done) {
  const app = express();
  app.get(/\/hello\/(.+)/, function (req, res) {
    res.end(`Hello ${req.params[0]}!`);
  });
  testRequest(
    app,
    "GET",
    "/hello/World",
    function (res, data) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(data, "Hello World!");
    },
    done,
  );
});

test("Respond 404 if no routes match", function (t, done) {
  const app = express();
  app.get("/hello", function (req, res) {
    res.end("Hello World!");
  });
  testRequest(
    app,
    "GET",
    "/world",
    function (res) {
      assert.strictEqual(res.statusCode, 404);
    },
    done,
  );
});

test("Respond 404 if the method does not match", function (t, done) {
  const app = express();
  app.get("/hello", function (req, res) {
    res.end("Hello World!");
  });
  testRequest(
    app,
    "POST",
    "/hello",
    function (res) {
      assert.strictEqual(res.statusCode, 404);
    },
    done,
  );
});

test("Define a route with two middleware", function (t, done) {
  const app = express();
  app.get(
    "/",
    function (req, res, next) {
      req.data = "Hello";
      next();
    },
    function (req, res) {
      res.end(req.data + " World!");
    },
  );
  testRequest(
    app,
    "GET",
    "/",
    function (res, data) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(data, "Hello World!");
    },
    done,
  );
});

test("Handle a middleware calling next('route')", function (t, done) {
  const app = express();
  app.get("/", function (req, res, next) {
    req.data = "Hello";
    next("route");
  });
  app.get("/", function (req, res) {
    res.end(req.data + " World!");
  });
  testRequest(
    app,
    "GET",
    "/",
    function (res, data) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(data, "Hello World!");
    },
    done,
  );
});

test("Mount a middleware at a path", function (t, done) {
  const app = express();
  app.use(function (req, res, next) {
    req.data = "Hello";
    next();
  });
  app.get("/hello", function (req, res) {
    res.end(req.data + " World!");
  });
  testRequest(
    app,
    "GET",
    "/hello",
    function (res, data) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(data, "Hello World!");
    },
    done,
  );
});

test("Handle a middleware throwing an error", function (t, done) {
  const app = express();
  app.get("/", function () {
    throw new Error("Oops!");
  });
  testRequest(
    app,
    "GET",
    "/",
    function (res) {
      assert.strictEqual(res.statusCode, 500);
    },
    done,
  );
});

test("Handle an error handler throwing an error", function (t, done) {
  const app = express();
  app.get("/", function () {
    throw new Error("Oops!");
  });
  // eslint-disable-next-line no-unused-vars
  app.use(function (err, req, res, next) {
    throw new Error("Oops again!");
  });
  testRequest(
    app,
    "GET",
    "/",
    function (res) {
      assert.strictEqual(res.statusCode, 500);
    },
    done,
  );
});

test("Respond with a custom error code and message", function (t, done) {
  const app = express();
  app.get("/", function () {
    throw new Error("Oops!");
  });
  // eslint-disable-next-line no-unused-vars
  app.use(function (err, req, res, next) {
    res.end(err.message);
  });
  testRequest(
    app,
    "GET",
    "/",
    function (res, data) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(data, "Oops!");
    },
    done,
  );
});
