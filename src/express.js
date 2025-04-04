"use strict";

const http = require("http");

/**
 * @param {string|RegExp} path - The route path or regular expression
 * @returns The complete regular expression to use to check the request URLs
 */
const pathToRegExp = (path) =>
  path instanceof RegExp
    ? new RegExp(`^${path.source}$`, path.flags)
    : new RegExp(`^${path}$`);

/**
 * @param {Error|null} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @returns {void}
 */
function finalHandler(err, req, res) {
  if (res.headersSent) {
    res.end();
  } else if (err) {
    res.writeHead(500);
    res.end("Internal Server Error");
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
}

/**
 * @callback NextFunction
 * @param {Error|'route'|null} [err] - The error
 * @returns {void}
 *
 * @callback Middleware
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {NextFunction} next - To call the next middleware for the route
 * @returns {void}
 *
 * @callback ErrorHandler
 * @param {Error} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {NextFunction} next - To call the next error handler for the route
 * @returns {void}
 *
 * @typedef {Object} Route
 * @property {number} [id] - The route identifier
 * @property {string} [method] - The HTTP method - will match any if not defined
 * @property {Middleware|ErrorHandler} middleware - The list of middleware
 * @property {RegExp} regexp - The regular expression to match the route's path
 */

/**
 * @param {Error|null} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {Route[]} routes - The list of unexplored routes
 */
function callMiddleware(err, req, res, routes) {
  if (!routes.length) {
    finalHandler(err, req, res);
    return;
  }

  const { id, method, middleware, regexp } = routes[0];

  /**
   * @type {NextFunction}
   */
  function next(err) {
    const remainingRoutes = routes.slice(1);
    if (!err) {
      callMiddleware(null, req, res, remainingRoutes);
    } else if (err === "route") {
      const routesInNextStack = routes.filter((r) => r.id !== id);
      callMiddleware(null, req, res, routesInNextStack);
    } else {
      callMiddleware(err, req, res, remainingRoutes);
    }
  }

  if (method && req.method !== method) {
    next(err);
    return;
  }

  const base = "http://localhost"; // Dummy base to allow URL to parse req.url
  const url = /** @type {string} */ (req.url); // req.url is always a string
  const { pathname, searchParams } = new URL(url, base);
  const match = pathname?.match(regexp);
  if (!match) {
    next(err);
    return;
  }

  req["params"] = match.slice(1);
  req["query"] = Object.fromEntries(searchParams.entries());

  // Wrap user-provided function calls in a try/catch block.
  try {
    if (err && middleware.length === 4) {
      /** @type {ErrorHandler} */ (middleware)(err, req, res, next);
    } else if (!err && middleware.length < 4) {
      /** @type {Middleware} */ (middleware)(req, res, next);
    } else {
      next(err);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Creates a not-express application.
 *
 * This is the top-level function exported by the package. When called, it
 * returns an application object that allows creating an HTTP server and
 * defining routes it will handle.
 *
 * @example
 * const express = require("not-express");
 * const app = express();
 * // Define routes...
 * app.listen(3000);
 *
 * @returns {Object} A not-express application object
 */
function createApplication() {
  /**
   * @type {Route[]} allRoutes - The list of user-defined routes
   */
  const allRoutes = [];

  const app = {};

  /**
   * Routes GET requests to the specified path with the specified callback
   * functions.
   *
   * If the path is a string, it will be used as the source for creating a
   * regular expression. In either case, do not include anchors (`^` and `$`) as
   * those are added automatically.
   *
   * @example
   * app.get("/", function (req, res) {
   *   res.end("Hello World!");
   * });
   *
   * @param {string|RegExp} path - The route path
   * @param {(Middleware|ErrorHandler)[]} callbacks - The list of middleware
   */
  app.get = function (path, ...callbacks) {
    const id = allRoutes.length;
    callbacks.flat().forEach(function (callback) {
      allRoutes.push({
        id,
        method: "GET",
        middleware: callback,
        regexp: pathToRegExp(path),
      });
    });
  };

  /**
   * Mounts the specified middleware functions at the base path ('/') so it is
   * executed on every request.
   *
   * @example
   * app.use(function (req, res, next) {
   *   console.log(req.url);
   *   next();
   * });
   *
   * @param {(Middleware|ErrorHandler)[]} callbacks - The middleware
   */
  app.use = function (...callbacks) {
    callbacks.flat().forEach(function (callback) {
      allRoutes.push({
        middleware: callback,
        regexp: /^\//,
      });
    });
  };

  /**
   * @param {http.IncomingMessage} req - The request
   * @param {http.ServerResponse} res - The response
   */
  function handleRequest(req, res) {
    callMiddleware(null, req, res, allRoutes);
  }

  /**
   * Starts the HTTP server listening for connections.
   *
   * @param {number} [port] - The port to listen on.
   */
  app.listen = (port) => http.createServer(handleRequest).listen(port);

  return app;
}

module.exports = createApplication;
