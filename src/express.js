/*
  Creating an ESM package and using it in an ESM environment works seamlessly, 
  but using it in a CJS environment introduces complexity. The possible 
  solutions are:
  
  - Dropping support for CJS entirely, as some package authors are doing,
  - Transpiling and exporting both ESM and CJS files, which adds extra scripts 
    and tools to the package setup, or
  - Continuing to use CJS.

  The last option minimizes complexity and maximizes compatibility. Therefore, 
  this file uses CJS and starts in strict mode for consistency and best 
  practices.
*/

"use strict";

/*
  A nice feature of this implementation is that it has no dependencies other 
  than the `http` module built into Node.js. This keeps the codebase lightweight 
  and free from unnecessary bloat.
*/

const http = require("http");

/*
  Before starting with the actual code, let's define some types that will help
  us later. These types are the usual suspects in any Connect/Express setup and 
  are mostly self-explanatory.

  Note: Connect/Express defines error handlers as functions receiving 4 
  parameters. While checking the number of parameters a function receives 
  may seem hacky, this was not my decision.
*/

/**
 * @callback ErrorHandler
 * @param {Error} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {NextFunction} next - To call the next error handler for the route
 * @returns {void}
 *
 * @callback Middleware
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {function} next - To call the next middleware for the route
 * @returns {void}
 *
 * @callback NextFunction
 * @param {Error|'route'|null} [err] - The error
 * @returns {void}
 */

/*
  Now, let’s define a tiny helper. In order to support path parameters but to 
  also keep the logic as simple as possible, there will be no support for named 
  path parameters. That avoids the need to do complex parsing of the request 
  URL. Node 23.8 comes with URLPattern built in, but let's skip that feature for 
  now as it is still experimental.
  
  To match the Express API, strings can be used to define static paths, and 
  regular expressions with capture groups can be used to define dynamic routes:

  app.get("/path") // This is a static path that will fully match or not.
  app.get("/id/(\\d+)") // This is equivalent to `/id/:number(\\d+)`.
  app.get(/\/id\/(\d+)/) // Regular expressions can be used too.

  If a string is provided, it will be transformed into a regular expression. 
  Then the regular expression will be used as is to match the request URL. In 
  either case, anchors (`^` and `$`) are added to enforce exact matches. If 
  anchors are provided manually, errors may occur. Avoid doing that.
  
  This function will be needed later when defining `app.get()`, but it serves as 
  a good starting point for discussing supported features and limitations.
*/

/**
 * @param {string|RegExp} path - The route path or regular expression
 * @returns The complete regular expression to use to check the request URLs
 */
const pathToRegExp = (path) =>
  path instanceof RegExp
    ? new RegExp(`^${path.source}$`, path.flags)
    : new RegExp(`^${path}$`);

/*
  Another little helper to define is an error handler that will be called when 
  no routes match the current request. It will allow sending a response to the
  caller, no matter what.

  Note: If a middleware sends the response headers and throws, any error
  handler that tries to send the headers again will also fail. This function, as 
  the last one that will handle the request if everything else fails, has to 
  consider that scenario. Be careful when writing middleware and avoid those
  traps.
*/

/**
 * @param {Error|null} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @returns {void}
 */
function finalHandler(err, req, res) {
  if (res.headersSent) {
    // Just terminate the response
    res.end();
  } else if (err) {
    // An error was thrown but no error handlers captured it or threw errors too
    res.writeHead(500);
    res.end("Internal Server Error");
  } else {
    // No defined routes matched the incoming request
    res.writeHead(404);
    res.end("Not Found");
  }
}

/*
  Note: Connect/Express uses to manage 404 and 500 errors by responding with an 
  HTML page with details about the errors. For simplicity, we are not doing 
  that, even though this represents a departure from the Express API behavior.

  At the heart of Connect/Express is the management of routes and middleware. 
  Each route may be handled by one or more middleware functions. These functions 
  can handle the request and send a response themselves or pass control to the 
  next middleware by calling `next`. If `next` is called with an error, the 
  error-handling middleware is invoked instead:

  middleware1 --next()--> middleware2 --next()--> middleware3
  middleware1 --next(err)--> errorHandler1

  To support that route-to-middleware relation, let's define a `Route` 
  structure.
*/

/**
 * @typedef {Object} Route
 * @property {number} [id] - The route identifier
 * @property {string} [method] - The HTTP method - will match any if not defined
 * @property {Middleware|ErrorHandler} middleware - The list of middleware
 * @property {RegExp} regexp - The regular expression to match the route's path
 */

/*
  Once the application routes are defined by associating the paths to middleware
  functions, it is time to implement the logic that will do the pattern 
  matching and sequence the middleware calls; The `callMiddleware` function.

  The function will resolve the problem recursively. If a route matches and 
  the middleware handles the request, the logic stops there. If not, the 
  middleware returns the control to `callMiddleware` by calling `next` and it 
  will continue the recursion with the remaining routes until no more routes are 
  available.

  As the routes are a flat list of route-to-middleware pairs, the logic of this 
  function is much simpler than in v3 of `not-express`, where each route 
  contained a list of middleware. In that case, two recursion loops were needed.
  As a downside, having such a simple routing structure does not allow 
  supporting calls like `next('route')`. There may be a way to support that with
  not much more code but since I needed to use that, I assume it is a feature we
  can simply skip.
*/

/**
 * @param {Error|null} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {Route[]} routes - The list of unexplored routes
 */
function callMiddleware(err, req, res, routes) {
  /*
    As this will be recursively called, if in this iteration we run out of 
    routes, there is nothing else we can do but to call the final handler to 
    send the caller a response.
  */

  if (!routes.length) {
    finalHandler(err, req, res);
    return;
  }

  /*
    Given we know now we have routes left, Let's extract the properties of the 
    first one.
  */

  const { id, method, middleware, regexp } = routes[0];

  /*
    But if we are lucky, we should have routes to try to process the request 
    through. In this case, the first step is to define the `next()` function. 
    This function is created dynamically during each iteration.

    Its logic is quite simple. It only needs to initiate the next "loop" with 
    the routes not yet explored and keep proper track of the errors that were 
    previously thrown, if any.

    Note: This behavior matches Express in the happy-path and basic 
    error-handling scenarios. However, it does not support more complex cases 
    such as calling `next("route")`. 
  */

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

  /*
    The first check is to verify the route method matches the request method. If 
    there is no match, the next route should be tried. In this check, if a route 
    does not specify a method, it is understood that it applies to all methods.
  */

  if (method && req.method !== method) {
    next(err);
    return;
  }

  /*
    If the method matches, then the request URL must be parsed and matched 
    against the route pattern. If a match is found, the capture groups will 
    contain the path parameters. These parameters are immediately assigned to 
    the `req` object. This also aligns with how Express handles routes defined 
    with regular expressions.

    Note: Parsing of the URL is done using a dummy "base". This allows using the 
    built-in URL parser, which is secure and performant, and avoids the need to 
    code a parser here or use an external package for that purpose.

    Of course, if there is no match, the process restarts with the next route.

    Finally, and before calling the middleware to handle the request, we must
    parse the query parameters. These are converted to an object and assigned to 
    the `req` object too, matching the Express API.
  */

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

  /*
    If the route method and pattern match the request, then it is time to call
    the middleware.

    If we are handling an error, we should only call error handlers. If there 
    are no errors, and the function is a standard middleware, we should simply 
    call `fn(req, res, next)`. In any other case, we have a mismatch type so we
    just skip to the next middleware.

    Since the middleware is provided by the user, it may fail. It will fail! So
    everything must be wrapped in a try/catch block. When an error is thrown, we
    can initiate the standard error handling mechanism by calling `next(err)`.

    Note: The errors thrown asynchronously will not be captured and will most 
    likely prevent any response from being sent to the client. This behavior is 
    consistent with [older versions of] Express, so don't feel bad about it. 
    Capturing errors thrown asynchronously is possible but complex. Again, be 
    responsible and write your middleware properly so I can keep this code 
    simple!
  */

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

/*
  The top-level export is a function that creates an application object. This 
  application object provides the following key functionalities to the user:

  - Defining routes and specifying the middleware to handle requests,
  - Attaching middleware to specific paths, and
  - Creating an HTTP server and starting it to listen for incoming requests.

  Express also offers additional features at the top level, such as commonly 
  used middleware and the Route factory. None of that is supported.
*/

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

  /*
    The two main functions exposed, `get()` and `use()`, mostly match their 
    Express counterparts but are slightly more restrictive:

    - `get` accepts a single path and a list of middleware. The path can be a 
      string or a regular expression. Arrays of paths are not supported.
    - `use` does not accept a path and defaults to "/".

    These restrictions align with the most common use cases. Adding more 
    functionality to support edgy or rarely used cases would have introduced 
    unnecessary complexity.

    At the application level, Express also provides other methods to deal with 
    template engines, other complex scenarios, etc. However, those are not part 
    of the minimum functionality required to create a simple HTTP API.
  */

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
   * Mounts the specified middleware functions at the root so it is executed on
   * every request.
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

  /*
    After defining these functions to register routes, we define the main 
    function that handles requests: `handleRequest`. This function just 
    initiates the middleware chain and is the one that is called by the HTTP
    server whenever a request is received.

    The last function is `listen`. As in Express, it creates the above mentioned
    HTTP server and starts listening on the specified port.
  */

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

  /*
    Don't forget to expose the functions defined above!
  */

  return app;
}

/*
  And before leaving, let's export the fabulous function we created above so 
  everyone can try `not-express`.
*/

module.exports = createApplication;
