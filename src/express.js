/*
  I've been exploring ESM modules lately, and specifically when creating Node.js
  packages, I found it is still lacking. While creating a package and using it
  in an ESM environment works fine, using an ESM package in a CJS environment is
  messy. The options are to drop support for CJS completely (as some package
  authors are doing), to transpile and export both ESM and CJS files with the
  package, or to keep using CJS to minimize complexity and maximize 
  compatibility. I chose the last approach. So, to start any file in the usual 
  CJS fashion, let's set strict mode on!
*/

"use strict";

/*
  A nice feature of this implementation is that it has no dependencies other 
  than the `http` module that comes built into Node.js. This is another way to 
  keep the codebase lightweight and un-bloated. Fewer dependencies, fewer 
  problems.
*/

const http = require("http");

/*
  The top-level export is a function that creates an application object. This 
  application object provides the following key functionalities:

  - Defining routes and specifying the middleware to handle requests,
  - Attaching middleware to specific paths, and
  - Creating an HTTP server and starting it to listen for incoming requests.

  Express also offers additional features at the top level, such as commonly 
  used middleware and the Route factory. At the application level, it provides 
  may methods to deal with template engines, complex scenarios, etc. However, we 
  will focus on the minimum functionality required to create a simple HTTP API:

  - Defining GET routes,
  - Attaching middleware to all routes (e.g., for handling CORS requests),
  - Defining error handlers, and
  - Creating the server and starting it to listen for requests.

  Note: Support for Promise-returning middleware, introduced in later versions 
  of Express, is not included in the list.

  The first step is to create the function that returns the application object 
  we will interact with. However, before that, we will define some helper 
  functions and middleware that will assist us along the way. These are standard 
  Connect-like middleware and are mostly self-explanatory.
*/

/**
 * @callback NextFunction
 * @param {Error|"route"} [err] - The error thrown or the "route" string
 * @returns {void}
 *
 * @callback Middleware
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {function} next - To call the next middleware for the route
 * @returns {void}
 *
 * @callback ErrorHandler
 * @param {Error} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {NextFunction} next - To call the next middleware for the route
 * @returns {void}
 */

/** @type {Middleware} */
function callNextRoute(req, res, next) {
  next("route");
}

/** @type {Middleware} */
function notFoundError(req, res) {
  res.writeHead(404);
  res.end("Not Found");
}

/** @type {ErrorHandler} */
// eslint-disable-next-line no-unused-vars
function internalServerError(err, req, res, next) {
  res.writeHead(500);
  res.end("Internal Server Error");
}

/*
  Note that the default handlers provided by Express to manage 404 and 500 
  errors typically return an HTML page with details about the errors or log the 
  error messages to the console. For simplicity, we are not doing so here, even 
  though this represents a departure from the Express API.

  It is also worth mentioning that `internalServerError` receives 4 parameters, 
  even though `next` is not used. This allows it to be properly identified as an 
  error handler. While checking the number of parameters a function receives may 
  seem hacky, this is exactly how Express identifies error handlers. So, no 
  complaints, please. This is not my fault.

  Now, let’s move on to the fun part by defining a tiny helper. Why? Because we 
  want to support path parameters. To keep the code as simple as possible, we 
  will not support named path parameters. Instead, we will allow only static 
  paths (strings) and path patterns (regular expressions with capture groups), 
  just like Express does:

  app.get("/path") // This is a static path that will fully match or not.
  app.get("/id/(\\d+)") // This is equivalent to `/id/:number(\\d+)`.

  The trick here is to identify these two scenarios and wrap the given route 
  with anchors (`^` and `$`) to enforce exact matches. This function will be 
  very helpful later when defining `app.get()`.

  For simplicity, let’s assume that paths are never defined with such anchors, 
  as is the common practice when using Express. If you want to break your code 
  by adding anchors to your own routes, go ahead. You are free to do so.
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
  And just because we were talking about routes, let's define what a route is,
  even though we will not use this structure for now. In fact, let's do it now
  because the next function will receive a list of routes as its last parameter.

  Each route may have an associated HTTP method. If not, the route is valid for 
  all methods. Additionally, each route needs to have a list of middleware, 
  which can include both regular middleware and error handlers, as well as a 
  regular expression to validate whether the route matches the incoming request, 
  as discussed above.
*/
/**
 * @typedef {Object} Route
 * @property {string} [method] - The HTTP method
 * @property {(Middleware|ErrorHandler)[]} middleware - The list of middleware
 * @property {RegExp} regexp - The regular expression to match the route's path
 */

/*
  At the heart of Connect and Express is the management of route middleware. 
  Each route may have one or more middleware functions. These functions can 
  handle the request or pass control to the next middleware by calling `next`. 
  If `next` is called with an error, the error-handling middleware is invoked 
  instead, following the same pattern:

  middleware1 --next()--> middleware2 --next()--> middleware3
  middleware1 --next(err)--> errorHandler1

  A special case occurs when `next` is called with the string "route". In this 
  case, none of the remaining middleware for the current route is executed. 
  Instead, control is transferred to the next route that matches the request.

  According to the Express documentation:

  | next('route') will work only in middleware functions that were loaded by 
  | using the app.METHOD() function.

  This exact behavior may not be fully supported here. For simplicity, both 
  regular request-handling middleware and error-handling middleware are called 
  using the same logic.

  The `callMiddleware` function will receive the `req` and `res` objects and 
  the list of middleware for the current route. It will then pick the first 
  middleware in the list and call it. The `next` function is created dynamically 
  to manage what happens next.

  The other two parameters `err` and `nextRoutes` will make sense in a moment. 
  Let's skip over those now.
*/

/**
 * @param {Error|null} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {(Middleware|ErrorHandler)[]} middleware - The list of middlewares
 * @param {Route[]} nextRoutes - The list of unexplored routes
 */
function callMiddleware(err, req, res, middleware, nextRoutes) {
  /*
    The `next` function is key as it allows transferring control flow between
    middleware, routes, and error handlers. Its logic, however, is quite simple.

    If it receives no error (the most common or "happy-path" scenario), it
    continues the chain of recursive calls by invoking `callMiddleware` with
    the remaining middleware (excluding the one that just called `next()`).

    What happens if you call `next(false)`? Don't try that at home!

    If there is an error, there are two possible scenarios:

    1. If the error is "route", control is passed to the list of middleware
       defined for the next matching route. This requires a recursive call to
       find the next route and start processing it from the beginning.

    2. If the error is an actual error object, it must be handled. Control is
       passed to the next route, signaling that an error is being handled and
       not just a normal request.

    In both cases, we need to know the list of unexplored routes that have not
    yet been tested against the request. This is why the `nextRoutes` parameter
    is passed to `callMiddleware`. Makes sense now?

    On a side note, the code for this function could be simplified further, but
    doing so might make it harder to read and reason about. A bit of redundancy
    seems like a good trade-off in this case.

    It is worth noting that this behavior matches Express in the happy-path and
    basic error-handling scenarios. However, it may not fully replicate Express
    in more complex cases, such as calling `next("route")` within an error
    handler or when an error handler is defined inside the middleware list for
    a specific route. These scenarios have not been tested!
*/

  /**
   * @type {NextFunction}
   */
  function next(err) {
    if (!err) {
      callMiddleware(null, req, res, middleware.slice(1), nextRoutes);
    } else if (err === "route") {
      findRouteAndCallMiddleware(null, req, res, nextRoutes);
    } else {
      findRouteAndCallMiddleware(err, req, res, nextRoutes);
    }
  }

  /*
    There are some scenarios that need to be considered before calling the 
    middleware function at the head of the list. Let's analyze those!

    Since this function is designed to be called recursively, it is possible 
    that the middleware list runs out of items. In that case, control should be 
    passed to the next route with `next("route")`.

    Remember, the same logic is used for both normal middleware functions and 
    error handlers. Therefore, it is important to determine which path we are 
    taking. This is done using the `err` parameter. If we are handling an error, 
    `err` will be truthy, and we should only call error handlers. If the current 
    function is not an error handler, we should skip it by calling `next()`. If 
    it is an error handler, we should call it with `fn(err, req, res, next)`.

    In any other case, where there are no errors, and the function is a standard 
    middleware, simply calling `fn(req, res, next)` is sufficient.

    Since the function is provided by the user, it may fail. To handle this, 
    everything is wrapped in a try/catch block. If an error is thrown, we should 
    initiate error handling by calling `next(err)`.

    Note that errors thrown asynchronously will not be captured and will most 
    likely prevent any response from being sent to the client. This behavior is 
    consistent with [older versions of] Express, so don't feel bad about it. 
    Capturing errors thrown asynchronously is possible but complex. To keep the 
    code simple, be responsible and write your middleware properly!
*/

  try {
    const fn = middleware[0];
    if (!fn) {
      next("route");
    } else if (err && fn.length !== 4) {
      next(err);
    } else if (err) {
      /** @type {ErrorHandler} */ (fn)(err, req, res, next);
    } else {
      /** @type {Middleware} */ (fn)(req, res, next);
    }
  } catch (err) {
    next(err);
  }
}

/*
  Now that we know how to recursively walk through a list of middleware defined
  for a specific route, we need to go a bit further and explain how to find a
  route that matches the request in the first place.

  To do so, the `matchRoute` function analyzes the request and a route to find 
  a match. It is implemented as a higher-order function to allow it to be easily 
  plugged into an `[].filter()` call later. The logic is straightforward: it 
  discards routes that do not match the request method and routes that do not 
  match the defined regular expression.

  Note that if a route does not specify a method, it applies to all methods. If 
  a match is found, the capture groups will contain the path parameters. These 
  parameters are immediately assigned to the `req` object. While a purist might 
  argue that introducing side effects into a `filter()` call is bad practice, 
  avoiding this would require re-executing the regular expression match outside 
  the loop to extract the parameters. This approach avoids that redundancy.

  Assigning the array of path parameters to the `params` property of `req` also
  aligns with how Express handles routes defined with regular expressions, as we 
  do here.
*/

/**
 * @param {http.IncomingMessage} req - The request
 * @returns A function that tells whether the route matches the request
 */
const matchRoute = (req) =>
  function (/** @type {Route} */ route) {
    if (route.method && req.method !== route.method) {
      return false;
    }

    const match = req.url?.match(route.regexp);
    if (!match) {
      return false;
    }

    req["params"] = match.slice(1);
    return true;
  };

/*
  And now we are reaching our last standalone helper, which will be in charge 
  of finding a route that matches the incoming request and starting the process 
  of calling all the middleware defined for that route.

  As explained above, `callMiddleware` will call each middleware, handle errors, 
  and return control back here if `next("route")` is called. When this happens, 
  it will continue processing the remaining routes that were defined after the 
  matching one.

  It is worth mentioning that there is no need to handle the case where no route 
  matches the request because of the way the routes are defined. As we will see 
  later in `handleRequest`, all requests will be processed through all the 
  user-defined routes and two default routes to handle the "route not found" 
  and "something went wrong" cases. These two routes match any request, are 
  always at the end, and are designed not to fail (TM)!

  Disclaimer: The default routes could fail, yes. For instance, if a middleware 
  sends the response headers, then fails, and the default error handler kicks 
  in and tries to send a status code 500, chaos would ensue. Don't do that. Be 
  careful when writing middleware. No safeguards will be added to the default 
  middleware "for simplicity." ;)
*/

/**
 * @param {Error|null} err - The error
 * @param {http.IncomingMessage} req - The request
 * @param {http.ServerResponse} res - The response
 * @param {Route[]} routes - The list of unexplored routes
 */
function findRouteAndCallMiddleware(err, req, res, routes) {
  const matchingRoute = /** @type {Route} */ (routes.find(matchRoute(req)));
  const nextRoutes = routes.slice(routes.indexOf(matchingRoute) + 1);
  callMiddleware(err, req, res, matchingRoute.middleware, nextRoutes);
}

/*
  Finally! All the helper functions and most of the inner functionality of the 
  library have been defined, explained, and exposed. It is time to mix it all 
  together and create an Express-like application.

  The function is very simple, matching the small set of features this library 
  supports.

  We start by defining two catch-all/default routes: one to respond with a 404 
  if no route matches, and another to respond with a 500 in case of an error. 
  These `defaultRoutes` are appended to the list of routes on each request. This 
  is done dynamically because the list of routes is defined by the `get` and 
  `use` functions and stored in the `allRoutes` array.

  These two functions are slightly more restrictive than their Express 
  counterparts:

  - `get` accepts a single path and a list of middleware. The path can be a 
    string or a regular expression. Arrays of paths are not supported.
  - `use` does not accept a path and defaults to "/". It also only accepts a 
    single middleware function.

  These restrictions align with the most common use cases. Adding more 
  functionality to support edge or rarely used cases would introduce unnecessary 
  complexity.

  After defining these functions to register routes, we define the main function 
  that handles requests: `handleRequest`. This function finds a matching route 
  and initiates the middleware chain. It also appends the default routes so 
  `findRouteAndCallMiddleware` never (*) fails.

  (*) This statement may not be 100% true.

  The last function is `listen`. As in Express, it creates an HTTP server and 
  starts listening on the specified port.
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
  const notFoundRoute = {
    middleware: [notFoundError],
    regexp: /^\//,
  };
  const internalServerErrorRoute = {
    middleware: [internalServerError],
    regexp: /^\//,
  };
  const defaultRoutes = [notFoundRoute, internalServerErrorRoute];
  const allRoutes = [];

  /**
   * Routes GET requests to the specified path with the specified callback
   * functions.
   *
   * @example
   * app.get("/", function (req, res) {
   *   res.end("Hello World!");
   * });
   *
   * @param {string|RegExp} path - The route path
   * @param {(Middleware|ErrorHandler)[]} callbacks - The list of middleware
   */
  function get(path, ...callbacks) {
    allRoutes.push({
      method: "GET",
      middleware: callbacks.flat(), // Flatten the list to support nested arrays
      regexp: pathToRegExp(path),
    });
  }

  /**
   * Mounts the specified middleware function at the root so it is executed on
   * every request.
   *
   * @example
   * app.use(function (req, res, next) {
   *   console.log(req.url);
   *   next();
   * });
   *
   * @param {Middleware|ErrorHandler} callback - The middleware
   */
  function use(callback) {
    allRoutes.push({
      middleware: [callback, callNextRoute],
      regexp: /^\//,
    });
  }

  /**
   * @param {http.IncomingMessage} req - The request
   * @param {http.ServerResponse} res - The response
   */
  function handleRequest(req, res) {
    findRouteAndCallMiddleware(null, req, res, allRoutes.concat(defaultRoutes));
  }

  /**
   * Starts the HTTP server listening for connections.
   *
   * @param {number} [port] - The port to listen on.
   */
  const listen = (port) => http.createServer(handleRequest).listen(port);

  return {
    get,
    listen,
    use,
  };
}

/*
  Before leaving, let's export the fabulous function we created above so 
  everyone can try `not-express`.
*/

module.exports = createApplication;
