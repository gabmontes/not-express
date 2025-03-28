"use strict";

/*
  Note: This implementation is minimal and does not handle all possible CORS 
  scenarios (e.g., preflight requests with the `OPTIONS` method). It is designed 
  to be lightweight and simple for basic use cases.
*/

/**
 * Creates a CORS middleware function.
 *
 * @param {Object} options - The configuration options for the middleware
 * @param {string[]} [options.methods] - An array of allowed methods
 * @param {string[]} options.origin - An array of allowed origins
 */
const createMiddleware = (options) =>
  /**
   * The CORS middleware function.
   *
   * @param {import('http').IncomingMessage} req - The incoming request
   * @param {import('http').ServerResponse} res - The outgoing response
   * @param {import('./express').NextFunction} next - To call the next middleware
   */
  function corsMiddleware(req, res, next) {
    const {
      "access-control-request-headers": accessControlRequestHeaders,
      origin,
    } = req.headers;

    // As there is no support to specify the allowed headers, just reflect the
    // request headers as `cors` does.
    if (accessControlRequestHeaders) {
      const requestHeaders = accessControlRequestHeaders;
      res.setHeader("Access-Control-Allow-Headers", requestHeaders);
    }

    const allowMethods = options.methods?.join(",") || "GET";
    res.setHeader("Access-Control-Allow-Methods", allowMethods);

    // Magic!
    const allowOrigin = origin && options.origin.includes(origin) && origin;
    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    }

    next();
  };

module.exports = createMiddleware;
